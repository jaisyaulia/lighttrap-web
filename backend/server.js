/* ============================================
   LIGHTTRAP UV — SERVER.JS
   Node.js + Express + MQTT + InfluxDB v2
   ============================================ */

require('dotenv').config();

const express = require('express');
const mqtt = require('mqtt');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

/* ============================================
   MIDDLEWARE
   ============================================ */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

/* ============================================
   INFLUXDB CONFIG
   ============================================ */
const INFLUX_URL = process.env.INFLUX_URL || 'http://localhost:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || 'your-influxdb-token';
const INFLUX_ORG = process.env.INFLUX_ORG || 'pakcoy';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'datasensor';

const influxClient = new InfluxDB({
  url: INFLUX_URL,
  token: INFLUX_TOKEN,
});

const writeApi = influxClient.getWriteApi(
  INFLUX_ORG,
  INFLUX_BUCKET,
  'ms'
);

const queryApi = influxClient.getQueryApi(INFLUX_ORG);

/* ============================================
   MQTT CONFIG
   ============================================ */
const MQTT_BROKER =
  process.env.MQTT_BROKER || 'mqtt://broker.emqx.io:1883';

const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId:
    'lighttrap-server-' +
    Math.random().toString(16).slice(2, 8),
  clean: true,
  reconnectPeriod: 3000,
});

const TOPIC_RELAY = 'lighttrap/relay';
const TOPIC_CONTROL = 'lighttrap/control';
const TOPIC_STATUS = 'lighttrap/status';
const TOPIC_SENSOR = 'lighttrap/sensor';
const TOPIC_SYNC = 'lighttrap/sync';

/* ============================================
   STATE IN-MEMORY
   ============================================ */
let systemState = {
  lampStatus: false,
  fanStatus: false,
  lux: 0,
  mode: 'auto',
  lastUpdated: null,
  mqttConnected: false,
};

/* ============================================
   JADWAL — FILE JSON
   ============================================ */
const SCHED_FILE = path.join(__dirname, 'schedules.json');

function loadSchedules() {
  try {
    if (fs.existsSync(SCHED_FILE)) {
      return JSON.parse(
        fs.readFileSync(SCHED_FILE, 'utf-8')
      );
    }
  } catch (e) {
    console.error('[SCHED] Load error:', e.message);
  }

  return [];
}

function saveSchedulesToFile(list) {
  try {
    fs.writeFileSync(
      SCHED_FILE,
      JSON.stringify(list, null, 2)
    );
  } catch (e) {
    console.error('[SCHED] Save error:', e.message);
  }
}

let schedules = loadSchedules();

let schedIdSeq =
  schedules.length > 0
    ? Math.max(...schedules.map((s) => s.id || 0)) + 1
    : 1;

/* ============================================
   SYNC JADWAL → NODE-RED
   ============================================ */
function syncSchedulesToNodeRed() {
  const payload = JSON.stringify({
    command: 'SYNC_SCHEDULES',
    schedules,
    timestamp: new Date().toISOString(),
  });

  mqttClient.publish(TOPIC_SYNC, payload, {
    qos: 1,
    retain: true,
  });

  console.log(
    '[SYNC] Jadwal sync:',
    schedules.length,
    'jadwal'
  );
}

/* ============================================
   MQTT EVENTS
   ============================================ */
mqttClient.on('connect', () => {
  console.log(
    '[MQTT] Connected to broker:',
    MQTT_BROKER
  );

  systemState.mqttConnected = true;

  mqttClient.subscribe(
    [TOPIC_STATUS, TOPIC_SENSOR],
    (err) => {
      if (err) {
        console.error(
          '[MQTT] Subscribe error:',
          err.message
        );
      } else {
        console.log(
          '[MQTT] Subscribe: status & sensor'
        );
      }
    }
  );

  syncSchedulesToNodeRed();
});

mqttClient.on('reconnect', () => {
  console.log('[MQTT] Reconnecting...');
  systemState.mqttConnected = false;
});

mqttClient.on('error', (err) => {
  console.error('[MQTT] Error:', err.message);
  systemState.mqttConnected = false;
});

mqttClient.on('message', (topic, message) => {
  console.log('[MQTT MSG]', topic, message.toString());

  try {
    const payload = JSON.parse(message.toString());

    /* ============================================
       STATUS DEVICE
       ============================================ */
    if (topic === TOPIC_STATUS) {

      if (payload.lamp !== undefined) {
        systemState.lampStatus = !!payload.lamp;
      }

      if (payload.fan !== undefined) {
        systemState.fanStatus = !!payload.fan;
      }

      if (
        payload.lux !== undefined &&
        !isNaN(payload.lux)
      ) {
        systemState.lux = Number(payload.lux);
      }

      if (payload.mode !== undefined) {
        systemState.mode = payload.mode;
      }

      systemState.lastUpdated =
        new Date().toISOString();

      systemState.mqttConnected = true;

      const point = new Point('lighttrap_v2')
        .tag('trigger', 'status')
        .floatField(
          'lux',
          systemState.lux || 0
        )
        .floatField(
          'lamp',
          systemState.lampStatus ? 1 : 0
        )
        .floatField(
          'fan',
          systemState.fanStatus ? 1 : 0
        )
        .stringField(
          'mode',
          systemState.mode || 'auto'
        );

      writeApi.writePoint(point);

      writeApi.flush()
        .then(() => {
          console.log(
            '[Influx] Status write success'
          );
        })
        .catch((err) => {
          console.error(
            '[Influx] Status write error:',
            err.message
          );
        });
    }

    /* ============================================
       SENSOR DATA
       ============================================ */
    if (topic === TOPIC_SENSOR) {

      if (
        payload.lux !== undefined &&
        !isNaN(payload.lux)
      ) {

        systemState.lux = Number(payload.lux);

        systemState.lastUpdated =
          new Date().toISOString();

        const point = new Point('lighttrap_v2')
          .tag('trigger', 'sensor')
          .floatField(
            'lux',
            systemState.lux
          )
          .floatField(
            'lamp',
            systemState.lampStatus ? 1 : 0
          )
          .floatField(
            'fan',
            systemState.fanStatus ? 1 : 0
          )
          .stringField(
            'mode',
            systemState.mode || 'auto'
          );

        writeApi.writePoint(point);

        writeApi.flush()
          .then(() => {
            console.log(
              '[Influx] Sensor write success:',
              systemState.lux
            );
          })
          .catch((err) => {
            console.error(
              '[Influx] Sensor write error:',
              err.message
            );
          });
      }
    }

  } catch (err) {
    console.error(
      '[MQTT PARSE ERROR]',
      err.message
    );
  }
});

/* ============================================
   HELPER PUBLISH CONTROL
   ============================================ */
function publishControl(command, mode, extra = {}) {

  const payload = JSON.stringify({
    command,
    mode,
    trigger: 'web_control',
    timestamp: new Date().toISOString(),
    ...extra,
  });

  mqttClient.publish(
    TOPIC_CONTROL,
    payload,
    { qos: 1 }
  );

  console.log(
    '[MQTT] Publish control:',
    payload
  );
}

/* ============================================
   API STATUS
   ============================================ */
app.get('/api/status', (req, res) => {

  res.json({
    success: true,
    data: {
      ...systemState,
      timestamp: new Date().toISOString(),
    },
  });

});

/* ============================================
   API CONTROL
   ============================================ */
app.post('/api/control', (req, res) => {

  const cmd =
    (req.body.command || '').toUpperCase();

  if (cmd !== 'ON' && cmd !== 'OFF') {
    return res.status(400).json({
      success: false,
      message: 'Command harus ON atau OFF',
    });
  }

  const isOn = cmd === 'ON';

  systemState.lampStatus = isOn;
  systemState.fanStatus = isOn;
  systemState.mode = 'manual';

  systemState.lastUpdated =
    new Date().toISOString();

  publishControl(cmd, 'manual');

  mqttClient.publish(
    TOPIC_RELAY,
    JSON.stringify({
      lamp: isOn,
      fan: isOn,
      cmd,
      mode: 'manual',
      timestamp: new Date().toISOString(),
    }),
    { qos: 1 }
  );

  const point = new Point('lighttrap_v2')
    .tag('trigger', 'web_control')
    .floatField(
      'lux',
      systemState.lux
    )
    .floatField(
      'lamp',
      isOn ? 1 : 0
    )
    .floatField(
      'fan',
      isOn ? 1 : 0
    )
    .stringField('mode', 'manual');

  writeApi.writePoint(point);

  writeApi.flush()
    .then(() => {
      console.log(
        '[Influx] Control write success'
      );
    })
    .catch((err) => {
      console.error(
        '[Influx] Control write error:',
        err.message
      );
    });

  res.json({
    success: true,
    message:
      `Perangkat berhasil di` +
      `${isOn ? 'aktifkan' : 'matikan'}`,
  });

});

/* ============================================
   API MODE
   ============================================ */
app.post('/api/mode', (req, res) => {

  const { mode } = req.body;

  if (
    !['auto', 'manual', 'jadwal']
      .includes(mode)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Mode tidak valid',
    });
  }

  systemState.mode = mode;

  mqttClient.publish(
    TOPIC_CONTROL,
    JSON.stringify({
      command: 'SET_MODE',
      mode,
      timestamp: new Date().toISOString(),
    }),
    { qos: 1 }
  );

  if (mode === 'jadwal') {
    syncSchedulesToNodeRed();
  }

  console.log('[MODE] Diubah ke:', mode);

  res.json({
    success: true,
    message:
      'Mode berhasil diubah ke ' + mode,
  });

});

/* ============================================
   API SCHEDULES
   ============================================ */
app.get('/api/schedules', (req, res) => {

  res.json({
    success: true,
    data: schedules,
  });

});

app.post('/api/schedules', (req, res) => {

  const {
    name,
    startTime,
    endTime,
    days,
    active,
  } = req.body;

  if (
    !name ||
    !startTime ||
    !endTime ||
    !Array.isArray(days) ||
    days.length === 0
  ) {
    return res.status(400).json({
      success: false,
      message: 'Field tidak lengkap',
    });
  }

  const newSched = {
    id: schedIdSeq++,
    name: name.trim(),
    startTime,
    endTime,
    days,
    active:
      active !== undefined
        ? !!active
        : true,
    createdAt:
      new Date().toISOString(),
  };

  schedules.push(newSched);

  saveSchedulesToFile(schedules);

  syncSchedulesToNodeRed();

  console.log(
    '[SCHED] Tambah:',
    newSched.name
  );

  res.json({
    success: true,
    data: newSched,
    message:
      'Jadwal berhasil ditambahkan',
  });

});

/* ============================================
   API HISTORY
   ============================================ */
app.get('/api/history', async (req, res) => {

  const rangeMap = {
    '1h': '-1h',
    '24h': '-24h',
    '7d': '-7d',
    '30d': '-30d',
  };

  const fluxRange =
    rangeMap[req.query.range] || '-24h';

  const fluxQuery = `
    from(bucket: "${INFLUX_BUCKET}")

      |> range(start: ${fluxRange})

      |> filter(fn: (r) =>
          r["_measurement"] == "lighttrap_v2"
      )

      |> filter(fn: (r) =>
          r["_field"] == "lux" or
          r["_field"] == "lamp" or
          r["_field"] == "fan" or
          r["_field"] == "mode"
      )

      // HAPUS kolom bentrok
      |> drop(columns: ["mode", "device_mode"])

      |> pivot(
          rowKey: ["_time"],
          columnKey: ["_field"],
          valueColumn: "_value"
      )

      |> sort(
          columns: ["_time"],
          desc: true
      )

      |> limit(n: 200)
  `;

  try {

    const rows = [];

    await new Promise((resolve, reject) => {

      queryApi.queryRows(fluxQuery, {

        next(row, tableMeta) {

          const o =
            tableMeta.toObject(row);

          const lampOn =
            o.lamp === 1 ||
            o.lamp === true ||
            o.lamp === '1' ||
            o.lamp === 'true';

          const fanOn =
            o.fan === 1 ||
            o.fan === true ||
            o.fan === '1' ||
            o.fan === 'true';

          rows.push({

            time: o._time,

            lux:
              parseFloat(o.lux) || 0,

            lamp: lampOn,

            fan: fanOn,

            mode: o.mode || 'auto',

          });

        },

        error(err) {
          reject(err);
        },

        complete() {
          resolve();
        },

      });

    });

    res.json({
      success: true,
      range:
        req.query.range || '24h',
      total: rows.length,
      data: rows,
    });

  } catch (err) {

    console.error(
      '[InfluxDB] Query error:',
      err.message
    );

    res.status(500).json({
      success: false,
      message: err.message,
      data: [],
    });

  }

});

/* ============================================
   API HEALTH
   ============================================ */
app.get('/api/health', (req, res) => {

  res.json({
    status: 'OK',
    mqtt:
      systemState.mqttConnected
        ? 'connected'
        : 'disconnected',
    uptime:
      Math.floor(process.uptime()) +
      ' detik',
    jadwal: schedules.length,
    time: new Date().toISOString(),
  });

});

/* ============================================
   SPA FALLBACK
   ============================================ */
app.get('*', (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      '../frontend',
      'index.html'
    )
  );

});

/* ============================================
   START SERVER
   ============================================ */
app.listen(PORT, () => {

  console.log('===========================================');
  console.log('  LightTrap UV Backend');
  console.log(`  http://localhost:${PORT}`);
  console.log(
    `  Health: http://localhost:${PORT}/api/health`
  );
  console.log('===========================================');

});
/* ============================================
   UPDATE SCHEDULE
   ============================================ */
app.put('/api/schedules/:id', (req, res) => {

  const id = parseInt(req.params.id);

  const idx = schedules.findIndex(
    (s) => s.id === id
  );

  if (idx === -1) {
    return res.status(404).json({
      success: false,
      message: 'Jadwal tidak ditemukan',
    });
  }

  const {
    name,
    startTime,
    endTime,
    days,
    active,
  } = req.body;

  const prev = schedules[idx];

  schedules[idx] = {

    ...prev,

    name:
      name !== undefined
        ? name.trim()
        : prev.name,

    startTime:
      startTime !== undefined
        ? startTime
        : prev.startTime,

    endTime:
      endTime !== undefined
        ? endTime
        : prev.endTime,

    days:
      days !== undefined
        ? days
        : prev.days,

    active:
      active !== undefined
        ? !!active
        : prev.active,

    updatedAt:
      new Date().toISOString(),

  };

  saveSchedulesToFile(schedules);

  syncSchedulesToNodeRed();

  console.log(
    '[SCHED] Update:',
    schedules[idx].name
  );

  res.json({
    success: true,
    data: schedules[idx],
    message: 'Jadwal berhasil diperbarui',
  });

});
/* ============================================
   DELETE SCHEDULE
   ============================================ */
app.delete('/api/schedules/:id', (req, res) => {

  const id = parseInt(req.params.id);

  const idx = schedules.findIndex(
    (s) => s.id === id
  );

  if (idx === -1) {
    return res.status(404).json({
      success: false,
      message: 'Jadwal tidak ditemukan',
    });
  }

  const nama = schedules[idx].name;

  schedules.splice(idx, 1);

  saveSchedulesToFile(schedules);

  syncSchedulesToNodeRed();

  console.log('[SCHED] Hapus:', nama);

  res.json({
    success: true,
    message: 'Jadwal berhasil dihapus',
  });

});

/* ============================================
   SHUTDOWN
   ============================================ */
process.on('SIGINT', () => {

  console.log('\n[SERVER] Shutting down...');

  writeApi.close().then(() => {

    mqttClient.end();

    process.exit(0);

  });

});