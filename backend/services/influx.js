const { InfluxDB } = require('@influxdata/influxdb-client');

require('dotenv').config();

const INFLUX_URL =
  process.env.INFLUX_URL ||
  'http://localhost:8086';

const INFLUX_TOKEN =
  process.env.INFLUX_TOKEN || '';

const INFLUX_ORG =
  process.env.INFLUX_ORG ||
  'jaisy';

const INFLUX_BUCKET =
  process.env.INFLUX_BUCKET ||
  'sensor';

let queryApi = null;

/* ============================================
   CONNECT INFLUXDB
   ============================================ */
function connect() {
  try {
    // Token wajib ada
    if (!INFLUX_TOKEN) {
      console.warn(
        '[InfluxDB] TOKEN kosong! Isi INFLUX_TOKEN di file .env'
      );

      return;
    }

    const influx = new InfluxDB({
      url: INFLUX_URL,
      token: INFLUX_TOKEN,
    });

    queryApi =
      influx.getQueryApi(
        INFLUX_ORG
      );

    console.log(
      '[InfluxDB] Query API siap'
    );

    console.log(
      '[InfluxDB] URL:',
      INFLUX_URL
    );

    console.log(
      '[InfluxDB] ORG:',
      INFLUX_ORG
    );

    console.log(
      '[InfluxDB] BUCKET:',
      INFLUX_BUCKET
    );
  } catch (e) {
    console.error(
      '[InfluxDB] Gagal inisialisasi:',
      e.message
    );
  }
}

/* ============================================
   QUERY HISTORY
   Membaca lux, lamp, fan, dan mode (tag)
   dalam satu query saja.
   ============================================ */
function queryHistory(
  range = '24h'
) {
  return new Promise(
    async (resolve, reject) => {
      if (!queryApi) {
        return reject(
          new Error(
            'InfluxDB belum terhubung'
          )
        );
      }

      /* ============================================
         QUERY NUMERIC + MODE TAG
         ============================================ */
      const queryNumeric = `
from(bucket: "${INFLUX_BUCKET}")
  |> range(start: -${range})
  |> filter(fn: (r) => r._measurement == "lighttrap")
  |> filter(fn: (r) =>
      r._field == "lux" or
      r._field == "lamp" or
      r._field == "fan"
  )
  |> pivot(
      rowKey: ["_time"],
      columnKey: ["_field"],
      valueColumn: "_value"
  )
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 500)
`;

      try {
        // Tidak perlu queryMode lagi, jalankan satu query saja
        const numericRows =
          await runQuery(
            queryNumeric
          );

        const results =
          numericRows.map(
            row => ({
              time:
                row._time,

              lux:
                row.lux !== undefined
                  ? parseFloat(
                      row.lux
                    )
                  : null,

              lamp:
                row.lamp !== undefined
                  ? (
                      row.lamp == 1 ||
                      row.lamp === true
                    )
                  : null,

              fan:
                row.fan !== undefined
                  ? (
                      row.fan == 1 ||
                      row.fan === true
                    )
                  : null,

              // mode dibaca langsung dari tag
              mode:
                row.mode || null,
            })
          );

        console.log(
          '[InfluxDB] Query selesai:',
          results.length,
          'baris'
        );

        resolve(results);
      } catch (err) {
        console.error(
          '[InfluxDB] Query error:',
          err.message
        );

        // Token invalid
        if (
          err.message &&
          err.message.includes(
            'unauthorized'
          )
        ) {
          reject(
            new Error(
              'InfluxDB: Token tidak valid atau expired'
            )
          );
        } else {
          reject(err);
        }
      }
    }
  );
}

/* ============================================
   HELPER QUERY
   ============================================ */
function runQuery(
  fluxQuery
) {
  return new Promise(
    (resolve, reject) => {
      const rows = [];

      queryApi.queryRows(
        fluxQuery,
        {
          next(
            row,
            tableMeta
          ) {
            rows.push(
              tableMeta.toObject(
                row
              )
            );
          },

          error(err) {
            reject(err);
          },

          complete() {
            resolve(rows);
          },
        }
      );
    }
  );
}

/* ============================================
   STATUS KONEKSI
   ============================================ */
function isConnected() {
  return queryApi !== null;
}

/* ============================================
   EXPORT
   ============================================ */
module.exports = {
  connect,
  queryHistory,
  isConnected,
};