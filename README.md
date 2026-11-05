# E-Duuka Admin

Standalone platform operations console for E-Duuka. It shows platform/shop account activity and subscription status; it intentionally does not display shop sales, balances, or payment details.

Administrators can edit shop contact details, owner and staff account details, staff roles, and subscription settings. Shop and account access can be deactivated or reactivated without deleting records; historical data is preserved.

The current subscription rate is UGX 30,000 per month. Monthly access is limited to one calendar month; expired subscriptions block shop access. The customer app warns two days before the due date. The payment checkout is provider-neutral and remains unavailable until a payment gateway is integrated. The gateway must verify payment notifications server-side before automatically renewing a subscription; the Finances page shows recurring projections, not confirmed receipts or historical income.

## Run locally

1. Configure the E-Duuka backend with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a separate strong `ADMIN_JWT_SECRET`. See the backend `.env.example`.
2. Set `VITE_API_URL` in this app's `.env` to the backend API URL (default: `http://localhost:3001/api`).
3. Install dependencies with `npm install`, then start with `npm run dev`.
4. Open `http://localhost:5174` and sign in using the configured platform-admin credentials.

Admin sessions use a separate signing secret and expire after eight hours. Configure the production admin frontend origin in the backend's `CORS_ORIGIN`.

The backend creates the subscription metadata columns for existing shops through its current TypeORM schema synchronization. New shops default to the Monthly plan and `trial` status; activate subscriptions according to E-Duuka's payment policy. Setting a shop to disabled, or its subscription to expired or suspended, blocks shop-owner and staff sign-ins and existing API sessions.
