# 🏠 Property Listing Website API (Node.js + Express + MongoDB)

A complete backend API for a **Property Listing Platform** that enables **agents** to list properties for rent or sale, **buyers** to explore and communicate, and **admins** to manage the ecosystem.  
This API also supports **Cloudinary file uploads**, **real-time notifications**, **Paystack escrow integration**, **WhatsApp/email alerts**, and **premium subscription plans**.

---

## 🚀 Features

### 👤 Authentication & User Management

- JWT-based login and registration
- Every registered user automatically becomes an **Agent**
- Premium upgrade via **Paystack subscription**
- Role-based access: **Admin** vs **Agent**
- Password hashing using **bcrypt**

### 🏘️ Property Management

- Upload property with **images/videos via Cloudinary**
- Edit or delete properties
- Property types: `rent` or `sale`
- Admin approval workflow (`pending`, `approved`, `rejected`)
- Featured listings for premium agents

### 💬 Communication

- In-app messaging between agents and customers
- WhatsApp “Send Message” integration
- Email notifications (Nodemailer)
- Real-time notifications using **Socket.io**

### 💸 Payments & Escrow

- **Paystack** integration for rent/purchase escrow
- Transaction tracking: `initiated`, `in_escrow`, `released`, `cancelled`
- Admin control to release or refund escrow payments

### 🔔 Notifications

- Multi-channel notifications:
  - In-app (WebSocket)
  - Email
- Triggered on major actions:
  - Registration
  - Property upload/update/delete
  - Rent/purchase actions
  - Premium subscription activation

---

## 🧱 Tech Stack

| Layer                     | Technology                               |
| ------------------------- | ---------------------------------------- |
| **Backend Framework**     | Node.js, Express.js                      |
| **Database**              | MongoDB (Mongoose ORM)                   |
| **Authentication**        | JWT, bcrypt                              |
| **File Storage**          | Cloudinary (Images & Videos)             |
| **Payment Gateway**       | Paystack                                 |
| **Notifications**         | Socket.io, Nodemailer, Twilio (WhatsApp) |
| **Environment Variables** | dotenv                                   |
| **Validation & Security** | express-validator, helmet, cors          |

---

## 🔐 Authentication

Authentication is handled using **JWT**. Protected routes require a valid token.

### Headers (Protected Routes)

```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

---

## 📦 API Modules

- Auth
- Users
- Properties
- Chat
- Notifications (planned)
- Escrow (planned)

---

## 🔑 AUTH ROUTES

Base path:

```
/api/auth
```

### Register User

**POST** `/register`

**Body (form-data / JSON)**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "buyer"
}
```

---

### Verify Account

**POST** `/verify`

**Body**

```json
{
  "email": "john@example.com",
  "code": "123456"
}
```

---

### Login

**POST** `/login`

**Body**

```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

---

### Google OAuth Login

**POST** `/google`

**Body**

```json
{
  "tokenId": "GOOGLE_ID_TOKEN"
}
```

---

## 👤 USER ROUTES

Base path:

```
/api/user
```

### Get Logged-in User

**GET** `/me`

🔒 Protected

---

### Update Profile

**PUT** `/update-profile`

🔒 Protected

**Body**

```json
{
  "name": "John Updated",
  "phone": "08000000000"
}
```

---

### Request Password Change

**POST** `/request-change-password`

🔒 Protected

---

### Change Password

**POST** `/change-password`

🔒 Protected

**Body**

```json
{
  "oldPassword": "oldpass",
  "newPassword": "newpass"
}
```

---

### Change Profile Picture

**POST** `/change-profile-picture`

🔒 Protected

**Body (form-data)**

```
profilePicture: <image file>
```

---

## 🏘️ PROPERTY ROUTES

Base path:

```
/api/property
```

> Handles property creation, updates, listing, and deletion.

(Endpoints documented inside `routes/property.js`)

---

## 💬 CHAT ROUTES

Base path:

```
/api/chat
```

> Handles one-to-one messaging, conversations, and message history.

(Endpoints documented inside `routes/chat.js`)

---

## 🔔 REAL-TIME (Socket.IO)

Socket.IO is initialized globally for:

- Real-time chat
- Online user tracking
- Notifications

### Socket Initialization

```js
global.io = io;
global.onlineUsers = new Map();
```

---

## ⚠️ Error Response Format

```json
{
  "success": false,
  "message": "Error message"
}
```

---

## ✅ Success Response Format

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

---

## 🧪 Testing

You can test the API using:

- Postman
