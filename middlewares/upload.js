const multer = require("multer");
const storage = multer.memoryStorage();

const uploadPropertyFiles = multer({
  storage,
}).fields([
  { name: "images", maxCount: 10 },
  { name: "video", maxCount: 1 },
]);

const uploadChatAttachments = multer({
  storage,
}).fields([
  { name: "images", maxCount: 5 },
  { name: "videos", maxCount: 5 },
]);

const uploadProfilePicture = multer({
  storage,
}).fields([{ name: "images", maxCount: 1 }]);

// For routes that use FormData but DO NOT upload files
const uploadNone = multer({ storage }).none();

module.exports = {
  uploadPropertyFiles,
  uploadChatAttachments,
  uploadProfilePicture,
  uploadNone,
};
