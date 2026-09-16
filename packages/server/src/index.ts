import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { productsRouter } from './routes/products.js';
import { sitesRouter } from './routes/sites.js';
import { shippingRouter } from './routes/shipping.js';
import { materialsRouter } from './routes/materials.js';
import { ordersRouter } from './routes/orders.js';
import { mallsRouter } from './routes/malls.js';
import { shopsRouter } from './routes/shops.js';
import { csvMappingsRouter } from './routes/csvMappings.js';
import { dashboardRouter } from './routes/dashboard.js';

const app = express();
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: false,
  })
);
app.use(express.json({ limit: '5mb' })); // CSV由来の受注データを想定してやや大きめに

// 書き込み系エンドポイントへの簡易レート制限（社内ツールなので緩め）
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return writeLimiter(req, res, next);
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// requireAuth は現状no-op。将来ここでOAuth2トークン検証に差し替える。
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sites', requireAuth, sitesRouter);
app.use('/api/shipping', requireAuth, shippingRouter);
app.use('/api/materials', requireAuth, materialsRouter);
app.use('/api/orders', requireAuth, ordersRouter);
app.use('/api/malls', requireAuth, mallsRouter);
app.use('/api/shops', requireAuth, shopsRouter);
app.use('/api/csv-mappings', requireAuth, csvMappingsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
});
