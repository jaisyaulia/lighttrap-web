const mqtt = require('mqtt');

require('dotenv').config();

const MQTT_HOST =
  process.env.MQTT_HOST ||
  'mqtt://localhost';

const MQTT_PORT =
  process.env.MQTT_PORT || 1883;

const TOPIC_STATUS =
  process.env.MQTT_TOPIC_STATUS ||
  'lighttrap/status';

const TOPIC_SENSOR =
  process.env.MQTT_TOPIC_SENSOR ||
  'lighttrap/sensor';

const TOPIC_CONTROL =
  process.env.MQTT_TOPIC_CONTROL ||
  'lighttrap/control';

let client = null;

// =====================================
// STATE SISTEM
// =====================================
let systemState = {

  lampStatus: false,

  fanStatus: false,

  lux: 0,

  mode: 'auto',

  lastUpdated: null,
};

// =====================================
// THRESHOLD AUTO MODE
// =====================================
const LUX_THRESHOLD = 10;

// =====================================
// CONNECT MQTT
// =====================================
function connect() {

  client = mqtt.connect(
    `${MQTT_HOST}:${MQTT_PORT}`
  );

  // =====================================
  // CONNECTED
  // =====================================
  client.on(
    'connect',
    () => {

      console.log(
        '[MQTT] Terhubung ke broker'
      );

      // Subscribe status
      client.subscribe(
        TOPIC_STATUS,
        (err) => {

          if (err) {

            console.error(
              '[MQTT] Gagal subscribe status:',
              err.message
            );

          } else {

            console.log(
              `[MQTT] Subscribe ke topic: ${TOPIC_STATUS}`
            );
          }
        }
      );

      // Subscribe sensor
      client.subscribe(
        TOPIC_SENSOR,
        (err) => {

          if (err) {

            console.error(
              '[MQTT] Gagal subscribe sensor:',
              err.message
            );

          } else {

            console.log(
              `[MQTT] Subscribe ke topic: ${TOPIC_SENSOR}`
            );
          }
        }
      );
    }
  );

  // =====================================
  // HANDLE MESSAGE
  // =====================================
  client.on(
    'message',
    (topic, message) => {

      try {

        const payload =
          JSON.parse(
            message.toString()
          );

        // =====================================
        // STATUS RELAY
        // =====================================
        if (
          topic === TOPIC_STATUS
        ) {

          // -----------------------------
          // MODE
          // -----------------------------
          if (
            payload.mode !== undefined
          ) {

            systemState.mode =
              payload.mode;
          }

          // -----------------------------
          // LUX
          // -----------------------------
          if (
            payload.lux !== undefined
          ) {

            systemState.lux =
              parseFloat(
                payload.lux
              );
          }

          // -----------------------------
          // RELAY STATUS
          // -----------------------------
          if (
            payload.lamp !== undefined
          ) {

            systemState.lampStatus =
              Boolean(
                payload.lamp
              );
          }

          if (
            payload.fan !== undefined
          ) {

            systemState.fanStatus =
              Boolean(
                payload.fan
              );
          }

          // =================================
          // AUTO MODE SAFETY
          // lux terang = paksa OFF
          // =================================
          if (
            systemState.mode ===
            'auto'
          ) {

            if (
              systemState.lux >=
              LUX_THRESHOLD
            ) {

              systemState.lampStatus =
                false;

              systemState.fanStatus =
                false;
            }

            if (
              systemState.lux <
              LUX_THRESHOLD
            ) {

              systemState.lampStatus =
                true;

              systemState.fanStatus =
                true;
            }
          }

          systemState.lastUpdated =
            new Date()
              .toISOString();

          console.log(
            '[MQTT] STATUS:',
            JSON.stringify(
              systemState
            )
          );
        }

        // =====================================
        // SENSOR LUX
        // =====================================
        if (
          topic === TOPIC_SENSOR
        ) {

          if (
            payload.lux !== undefined
          ) {

            systemState.lux =
              parseFloat(
                payload.lux
              );

            // =================================
            // AUTO MODE
            // lux jadi source of truth
            // =================================
            if (
              systemState.mode ===
              'auto'
            ) {

              const isDark =
                systemState.lux <
                LUX_THRESHOLD;

              systemState.lampStatus =
                isDark;

              systemState.fanStatus =
                isDark;
            }
          }

          systemState.lastUpdated =
            new Date()
              .toISOString();

          console.log(
            '[MQTT] SENSOR:',
            JSON.stringify({
              lux:
                systemState.lux,

              lamp:
                systemState.lampStatus,

              fan:
                systemState.fanStatus,
            })
          );
        }

      } catch (e) {

        console.error(
          '[MQTT] Payload tidak valid:',
          e.message
        );
      }
    }
  );

  // =====================================
  // MQTT EVENTS
  // =====================================
  client.on(
    'error',
    (err) => {

      console.error(
        '[MQTT] Error:',
        err.message
      );
    }
  );

  client.on(
    'offline',
    () => {

      console.warn(
        '[MQTT] Offline'
      );
    }
  );

  client.on(
    'reconnect',
    () => {

      console.log(
        '[MQTT] Reconnect...'
      );
    }
  );
}

// =====================================
// PUBLISH CONTROL
// =====================================
function publish(payload) {

  if (
    !client ||
    !client.connected
  ) {

    console.error(
      '[MQTT] Tidak terhubung'
    );

    return false;
  }

  const message =
    JSON.stringify(payload);

  client.publish(
    TOPIC_CONTROL,
    message,
    {
      qos: 1,
      retain: false,
    },

    (err) => {

      if (err) {

        console.error(
          '[MQTT] Publish gagal:',
          err.message
        );

      } else {

        console.log(
          '[MQTT] Publish:',
          message
        );
      }
    }
  );

  return true;
}

// =====================================
// GET STATE
// =====================================
function getState() {

  return systemState;
}

// =====================================
// STATUS KONEKSI
// =====================================
function isConnected() {

  return (
    client &&
    client.connected
  );
}

// =====================================
// EXPORT
// =====================================
module.exports = {

  connect,

  publish,

  getState,

  isConnected,
};