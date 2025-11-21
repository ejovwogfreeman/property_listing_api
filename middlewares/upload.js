const multer = require("multer");
const storage = multer.memoryStorage();

const uploadPropertyFiles = multer({
  storage,
}).fields([
  { name: "images", maxCount: 10 },
  { name: "video", maxCount: 1 },
]);

module.exports = {
  uploadPropertyFiles,
};
