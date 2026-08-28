const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer(); // Handles multipart/form-data text fields
const {
  walletFunding,
  verifyWalletFunding,
  payAgent,
  changeTransactionStatus,
  getUserTransactions,
  getAgentTransactions,
  getAllTransactions,
  requestWithdrawal,
} = require("../controllers/transaction");
const { protect, authorize } = require("../middlewares/auth");

// ---------------------------
// Transaction Routes
// ---------------------------

// Fund Wallet
router.post("/fund-wallet", protect, upload.none(), walletFunding);

// Verify Fund Wallet
router.post(
  "/verify-fund-wallet",
  protect,
  authorize("admin"),
  upload.none(),
  verifyWalletFunding,
);

// Pay Agent
router.post("/pay-agent", protect, authorize("admin"), upload.none(), payAgent);

// Change Transaction Status
router.post(
  "/change-transaction-status",
  protect,
  authorize("admin"),
  upload.none(),
  changeTransactionStatus,
);

// Get User Transactions
router.get("/user-transactions", protect, getUserTransactions);

// Get Agent Transactions
router.get(
  "/agent-transactions",
  protect,
  authorize("admin"),
  getAgentTransactions,
);

// Get All Transactions
router.get(
  "/all-transactions",
  protect,
  authorize("admin"),
  getAllTransactions,
);

// Get All Transactions
router.get("/withdraw", protect, authorize("agent"), requestWithdrawal);

module.exports = router;
