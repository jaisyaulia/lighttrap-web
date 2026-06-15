const express = require('express');

const router = express.Router();

const mqttService =
  require('../services/mqtt');

/* ============================================
   GET STATUS
   ============================================ */
router.get(
  '/status',
  (req, res) => {

    const state =
      mqttService.getState();

    res.json({

      success: true,

      data: {

        lampStatus:
          state.lampStatus,

        fanStatus:
          state.fanStatus,

        lux:
          state.lux,

        mode:
          state.mode,

        lastUpdated:
          state.lastUpdated,

        mqttConnected:
          mqttService.isConnected(),
      },
    });
  }
);

/* ============================================
   CONTROL RELAY
   Body:
   {
     "command": "ON"
   }

   atau

   {
     "command": "OFF"
   }
   ============================================ */
router.post(
  '/control',
  (req, res) => {

    const { command } =
      req.body;

    const cmd =
      (command || '')
        .toUpperCase();

    // Validasi command
    if (
      !['ON', 'OFF']
        .includes(cmd)
    ) {

      return res.status(400)
        .json({

          success: false,

          message:
            'command harus ON atau OFF',
        });
    }

    // ========================================
    // PUBLISH KE MQTT
    // ========================================
    const payload = {

      lamp:
        cmd === 'ON',

      fan:
        cmd === 'ON',

      cmd,

      mode: 'manual',

      timestamp:
        new Date()
          .toISOString(),
    };

    const ok =
      mqttService.publish(
        payload
      );

    // MQTT gagal
    if (!ok) {

      return res.status(503)
        .json({

          success: false,

          message:
            'MQTT tidak terhubung',
        });
    }

    res.json({

      success: true,

      message:
        `Perintah ${cmd} dikirim`,

      payload,
    });
  }
);

/* ============================================
   GANTI MODE
   Body:
   {
     "mode": "auto"
   }

   Mode:
   - auto
   - manual
   - jadwal
   ============================================ */
router.post(
  '/mode',
  (req, res) => {

    const { mode } =
      req.body;

    const validModes = [

      'auto',

      'manual',

      'jadwal',
    ];

    // Validasi mode
    if (
      !mode ||
      !validModes.includes(
        mode
      )
    ) {

      return res.status(400)
        .json({

          success: false,

          message:
            'mode tidak valid',
        });
    }

    // ========================================
    // PUBLISH MODE KE MQTT
    // ========================================
    const payload = {

      command:
        'SET_MODE',

      mode,

      timestamp:
        new Date()
          .toISOString(),
    };

    mqttService.publish(
      payload
    );

    res.json({

      success: true,

      message:
        `Mode diganti ke: ${mode}`,

      mode,
    });
  }
);

/* ============================================
   EXPORT ROUTER
   ============================================ */
module.exports = router;