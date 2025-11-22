const multer = require("multer");
const storage = multer.memoryStorage();

const uploadPropertyFiles = multer({
  storage,
}).fields([
  { name: "images", maxCount: 10 },
  { name: "video", maxCount: 1 },
]);

// For routes that use FormData but DO NOT upload files
const uploadNone = multer({ storage }).none();

module.exports = {
  uploadPropertyFiles,
  uploadNone,
};
