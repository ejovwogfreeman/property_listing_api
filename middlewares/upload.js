const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const imageStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "realestate/images",
    resource_type: "image",
    format: "auto",
    transformation: [{ width: 1600, quality: "auto" }],
  }),
});

const videoStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "realestate/videos",
    resource_type: "video",
    format: "mp4",
    transformation: [{ quality: "auto" }, { height: 720 }],
  }),
});

const fileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "realestate/files",
    resource_type: "auto",
  }),
});

const upload = multer({ storage: imageStorage });

// helpers to use in routes
module.exports = {
  uploadImages: multer({ storage: imageStorage }).array("images", 10),
  uploadSingleVideo: multer({ storage: videoStorage }).single("video"),
  uploadChatFile: multer({ storage: fileStorage }).single("file"),
  rawMulter: multer({ storage: fileStorage }),
};
