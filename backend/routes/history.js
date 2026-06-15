const express = require('express');

const router = express.Router();

const influxService =
  require('../services/influx');

/* ============================================
   GET HISTORY
   Endpoint:
   GET /api/history?range=24h

   Range:
   - 1h
   - 24h
   - 7d
   - 30d
   ============================================ */
router.get(
  '/',
  async (req, res) => {

    const range =
      req.query.range || '24h';

    const validRanges = [
      '1h',
      '24h',
      '7d',
      '30d',
    ];

    // Validasi range
    if (
      !validRanges.includes(range)
    ) {

      return res.status(400).json({

        success: false,

        message:
          'range tidak valid. Gunakan: 1h, 24h, 7d, 30d',

        data: [],
      });
    }

    // Cek koneksi influx
    if (
      !influxService.isConnected()
    ) {

      return res.status(503).json({

        success: false,

        message:
          'InfluxDB belum terhubung. Cek INFLUX_TOKEN di backend/.env',

        data: [],
      });
    }

    try {

      // Query data history
      const data =
        await influxService.queryHistory(
          range
        );

      // Success response
      res.json({

        success: true,

        range,

        total: data.length,

        data,
      });

    } catch (err) {

      console.error(
        '[History] Query gagal:',
        err.message
      );

      // Response error
      res.status(500).json({

        success: false,

        message:
          err.message ||
          'Gagal mengambil data dari InfluxDB',

        data: [],
      });
    }
  }
);

/* ============================================
   EXPORT ROUTER
   ============================================ */
module.exports = router;