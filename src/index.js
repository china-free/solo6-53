const express = require('express');
const { initDatabase } = require('./db');

const webhooksRoutes = require('./routes/webhooks');
const webhookReceiveRoutes = require('./routes/webhook-receive');
const logsRoutes = require('./routes/logs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'WebHook API Service');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    service: 'webhook-api-service',
    version: '1.0.0'
  });
});

app.use('/api/webhooks', webhooksRoutes);
app.use('/webhook', webhookReceiveRoutes);
app.use('/api/logs', logsRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

async function startServer() {
  try {
    await initDatabase();
    console.log('Database initialized successfully');

    app.listen(PORT, () => {
      console.log(`\n============================================================`);
      console.log(`  WebHook API Service is running!`);
      console.log(`  Server: http://localhost:${PORT}`);
      console.log(`  Health: http://localhost:${PORT}/api/health`);
      console.log(`============================================================`);
      console.log(`\n  API Endpoints:`);
      console.log(`  ─────────────────────────────────────────────────────────`);
      console.log(`  WebHook Management:`);
      console.log(`    POST   /api/webhooks                  - Create WebHook`);
      console.log(`    GET    /api/webhooks                  - List WebHooks`);
      console.log(`    GET    /api/webhooks/:id              - Get WebHook details`);
      console.log(`    PUT    /api/webhooks/:id              - Update WebHook`);
      console.log(`    POST   /api/webhooks/:id/status       - Pause/Enable WebHook`);
      console.log(`    POST   /api/webhooks/:id/refresh-token - Refresh receive token`);
      console.log(`    DELETE /api/webhooks/:id              - Delete WebHook`);
      console.log(`  ─────────────────────────────────────────────────────────`);
      console.log(`  Receive Endpoint (独立接收地址):`);
      console.log(`    POST   /webhook/:token                - Receive and forward`);
      console.log(`  ─────────────────────────────────────────────────────────`);
      console.log(`  Logs:`);
      console.log(`    GET    /api/logs                       - List logs`);
      console.log(`    GET    /api/logs/stats                 - Log statistics`);
      console.log(`    GET    /api/logs/:id                   - Get log details`);
      console.log(`    DELETE /api/logs/:id                   - Delete log`);
      console.log(`============================================================\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
