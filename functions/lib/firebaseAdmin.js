"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.FIRESTORE_DATABASE_ID = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const app = (0, app_1.getApps)()[0] || (0, app_1.initializeApp)();
// This is a public Firebase resource identifier, not a credential. Keep it aligned
// with firebase-applet-config.json; an environment override supports other stages.
exports.FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID
    || 'ai-studio-outpoststudentho-f2f5cd38-bc33-486e-897b-2f36813511f0';
exports.db = (0, firestore_1.getFirestore)(app, exports.FIRESTORE_DATABASE_ID);
//# sourceMappingURL=firebaseAdmin.js.map