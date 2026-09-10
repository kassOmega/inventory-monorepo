# Inventory System 🚀

A enterprise-grade, cloud-based inventory and sales management system built specifically for electrical installation businesses. It tracks items from the moment they are purchased from a supplier, stored in categorized warehouses, requested by shop branches, dispatched, and finally sold to customers.

Designed with strict Role-Based Access Control (RBAC) to enforce accountability, track profits accurately, and prevent stock discrepancies across multiple branches.

---

## ✨ Key Features

### **1. Role-Based Access Control (RBAC)**

- **Owner:** Full system access. Views global financial reports, manages users, approves stock requests, and oversees all locations.
- **Storekeeper:** Manages warehouse inventory. Restocks items, dispatches approved requests to shops, and views warehouse-specific low-stock alerts.
- **Shopkeeper:** Manages their specific shop. Creates stock requests, processes sales, and views their shop's current inventory.

### **2. Dynamic Product Management**

- **Categories:** Group products (e.g., Cables, Bulbs, Sockets) with a quick-add feature.
- **JSONB Attributes:** No rigid columns. Products use dynamic key-value attributes (e.g., `Watt: 12W`, `Type: Spot`, `Size: 2.5mm`), allowing infinite variations without changing the database schema.

### **3. Core Workflows**

- **Restocking & Price History:** When stock is bought and prices change, the system automatically logs the old/new prices to a Price History table and updates the master product price.
- **Stock Request Workflow:** Shopkeepers request stock → Owner Approves/Rejects → Storekeeper Dispatches. Dispatching uses secure database transactions to automatically decrement store inventory and increment shop inventory.
- **Sales & Profit Tracking:** Shopkeepers sell via a cart system. The system snapshots buy/sell prices at the time of sale to ensure historical profit reports remain 100% accurate even if master prices change later.

### **4. Advanced Reporting & Analytics**

- **Unified Filters:** Global filtering by Date Range, Location, Category, and Search Term across all reports.
- **Inventory Breakdown:** A dynamic pivot table showing total stock per product, broken down by every location.
- **Financial Graphs:** Visual dashboards (Line charts for revenue trends, Bar charts for top-selling products) and financial cards (Revenue, Cost, Profit, Margin).
- **Alerts & Audit:** Automated Low Stock alerts, Dead Stock tracking (items not sold in 3+ months), and a secure Audit Trail logging every system action.

### **5. Account Verification (KYC)**

- **User & business verification:** Owner accounts upload a renewed **national ID** (required); businesses upload a renewed **trade license** (required) and a **TIN registration certificate** (optional).
- **AI agent review:** Every uploaded document is reviewed by the Gemini vision agent. Clear documents are auto-approved; suspicious / low-confidence ones are **flagged** and sent to the platform admin with a notification.
- **Operation gating:** Until a user's account (and the active business) is `APPROVED`, only verification, profile, auth and notification endpoints are reachable — everything else returns `403`.
- **Notifications:** Admins are notified when an account/business is created and when the AI flags a document; users are notified of every approval / rejection (with the rejection reason) and can re-upload a legitimate file.
- **Anti-fraud blocking:** After `VERIFICATION_MAX_SCAM_ATTEMPTS` (default 4) admin rejections, the account or business is **permanently BLOCKED**.
- **Admin review queue:** `GET /admin/verification` + approve/reject endpoints power the platform-admin review UI (`/dashboard/admin/verification`).

### **6. Per-Industry Schema Separation**

Businesses are separated by industry, each with its own data model, API modules and frontend screens:

- **Retail & Distribution** — products, inventory, sales, stock requests, purchases, credits, returns.
- **Hospitality** — menu, orders, kitchen/bar/barista stations, tables, rooms, reservations, folios, cash floats.
- **Service** — catalog (`ServiceCategory`/`ServiceItem`), bookings/appointments (`ServiceBooking`), tickets + payments (`ServiceTicket`/`ServiceTicketItem`/`ServicePayment`).
- **Manufacturing** — materials (`Material`), bills of materials (`BillOfMaterial`/`BomLine`), production runs (`ProductionRun`/`ProductionRunItem`). Completing a run is a transaction that verifies raw-material sufficiency, consumes raws, produces finished goods, and writes a ledger.
- **Shared foundation** (users, organizations, roles/permissions, payment methods, finance, verification, notifications) stays common, scoped by `tenantId`.
- **Per-vertical profiles** (`RetailProfile`, `HospitalityProfile`, `ManufacturingProfile`, `ServiceProfile`) hold 1:1 typed settings per organization (lazy-created, editable via `PATCH /tenants/:id/profile`, exposed via `GET /tenants/me`).
- **Enforcement:** controllers decorated with `@Vertical(...)` are restricted to the matching `businessType` by the `VerticalGuard` (businessType resolved from the active org via `req.tenantId`). Enable with `VERTICAL_ENFORCEMENT=true` (default `false`).

---

## 🛠 Tech Stack

**Backend:** [NestJS](https://nestjs.com/) (TypeScript), [Prisma ORM](https://www.prisma.io/), PostgreSQL  
**Frontend:** [Next.js](https://nextjs.org/) (React), Tailwind CSS, [Recharts](https://recharts.org/)  
**Authentication:** JWT (JSON Web Tokens), Passport, Bcrypt  
**Architecture:** REST API, Modular Design, Role-Based Guards

---

## ⚙️ Installation & Setup

Follow these steps to run the project locally. You will need **Node.js (v20.19+)** and **PostgreSQL** installed.

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/electrical-inventory.git
cd electrical-inventory
```

### 2. Backend Setup (`/backend`)

```bash
cd backend
npm install
```

Create a `.env` file in the backend root:

```env
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/inventory_db?schema=public"
JWT_SECRET="your_super_secret_jwt_key"
```

Setup the database and seed the initial Owner account:

```bash
# Create the database tables
npx prisma db push

# Generate Prisma Client
npx prisma generate

# Seed the database with the primary Owner account
npx prisma db seed
```

Start the backend server:

```bash
npm run start:dev
```

_(Backend runs on `http://localhost:3000`)_

### 3. Frontend Setup (`/frontend`)

Open a new terminal window:

```bash
cd frontend
npm install
```

Create a `.env.local` file in the frontend root (optional, defaults to localhost:3000):

```env
NEXT_PUBLIC_API_URL="http://localhost:3000"
```

Start the frontend server:

```bash
npm run dev
```

_(Frontend runs on `http://localhost:3001` or `3000`)_

---

## 🔑 Default Credentials

The database seed script automatically creates the primary Owner account. Use these credentials to log in for the first time:

- **Email:** `owner@inventory.com`
- **Password:** `password123`

_(Once logged in as the Owner, you can use the "Manage Users" page to create Shopkeeper and Storekeeper accounts and assign them to specific locations)._

---

## 📂 Project Structure

### Backend Modules

- `AuthModule`: Registration, login, JWT strategy, and user profile management.
- `UsersModule`: Owner-only user management (CRUD).
- `LocationsModule`: Manages Shops and Stores.
- `CategoriesModule`: Manages product categories.
- `ProductsModule`: Master product list and JSONB attributes.
- `UnitsModule`: Manages measuring units.
- `RestockModule`: Owner-only restocking (storekeeper confirms receipt before inventory is finalized).
- `RequestsModule`: Stock request, approval, dispatch, and receipt-confirmation lifecycle.
- `SalesModule`: Cart checkout, inventory deduction, and profit calculation.
- `PurchasesModule`: Quick shopkeeper purchases (owner approves).
- `CustomersModule`: Manages credit customers.
- `CreditSalesModule` / `CreditPaymentsModule`: Credit sales and payment tracking.
- `PaymentMethodsModule`: Manages payment methods.
- `NotificationsModule`: In-app notifications (low stock, request status).
- `PushModule`: Browser push notifications (web-push).
- `PriceHistoryModule`: Price-change audit log.
- `ReportsModule`: Aggregates data for dashboards, financials, and alerts.

### Frontend Routing (`/app/dashboard`)

- `/dashboard`: Role-based home view (Owner sees graphs, Staff sees inventory).
- `/products`: Product master list with dynamic attributes and filtering.
- `/restock`: Owner restocking interface (storekeeper confirms receipt).
- `/requests`: Stock request workflow board (approve, dispatch, confirm receipt).
- `/sales`: Point of Sale (POS) interface for shopkeepers.
- `/purchases`: Shopkeeper quick purchases (owner approves).
- `/credits`: Credit customers, sales, and payments.
- `/locations`: Manage shops and stores (Owner only).
- `/reports`: Advanced analytics and reporting with global filters.
- `/users`: User management (Owner only).
- `/prices`: Price history audit log.
- `/profile`: User profile and password management.

---

## 🚀 Future Enhancements (Roadmap)

- **Barcode/QR Code Integration:** USB scanner support for rapid checkout and restocking.
- **PWA (Progressive Web App):** Offline mode for shopkeepers to process sales during internet outages, syncing automatically when reconnected.
- **Store-to-Store Transfers:** Allowing storekeepers to transfer items between categorized warehouses (e.g., moving cables from a main store to a cable-specific store).

---

_Built with ❤️ using NestJS and Next.js_
# inventory-backend
