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
  - WhatsApp
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

## 📂 Folder Structure
