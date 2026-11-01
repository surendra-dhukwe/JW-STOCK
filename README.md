# JW-ST Stock Management

Starter stock-management app built with HTML, CSS, vanilla JavaScript, Node.js, Express and MongoDB/Mongoose.

## Current configuration
- Multiple user registration and login
- New accounts remain pending until admin approves them
- Admin and approved users can create catalogue items
- Each item has one unit: PCS or KG. This prevents mixing incompatible units in one item balance.
- Both RECEIVE and DISPATCH entries require admin approval
- Only approved transactions affect final stock
- Transaction history, item photos, transaction photos and shared team chat

## Requirements
- Node.js 18+
- MongoDB Community Server or MongoDB Atlas

## Setup
1. Extract the ZIP and open `JW-ST` in VS Code.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set a strong `JWT_SECRET`, a strong `ADMIN_PASSWORD`, and your MongoDB `MONGO_URI`.
5. Start MongoDB.
6. Run `npm run dev` (or `npm start`).
7. Visit `http://localhost:5000`.
8. Login using the admin username/password configured in `.env`.
9. Admin approves new users in **Users**. Every approved user can add catalogue items and submit RECEIVE/DISPATCH transactions. Admin approves or rejects both transaction types in **Approvals**.

## Stock rules
- Each item is assigned exactly one unit (PCS or KG).
- Do not create the same physical product twice with different units; keep one unique item code per item/unit definition.
- Receive adds quantity only after approval.
- Dispatch subtracts quantity only after approval.
- Pending/rejected transactions do not affect stock.
- The server checks available stock again at dispatch approval time.

## Important production notes
- Do not deploy with example admin password or JWT secret. Keep `.env` private and never commit it.
- Uploaded images are stored in local `uploads/`. Use persistent/object storage on production hosts.
- This is a functional starter, not a hardened production ERP. Before real business use, add atomic database transactions or stock reservations for simultaneous dispatch approvals, audit logs, rate limiting, stricter image validation, backups, HTTPS and CSRF protections.
- Chat refreshes every 3 seconds (polling), not WebSocket realtime.
"# JW-STOCK" 
