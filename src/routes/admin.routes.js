// src/routes/admin.routes.js
// Админские маршруты. Требуют JWT + роль admin.
const express = require('express');
const { verifyToken, isAdmin } = require('../auth/middleware');
const { listAll } = require('../controllers/bookings.controller');

const router = express.Router();

router.use(verifyToken);
router.use(isAdmin);

router.get('/bookings', listAll);

module.exports = router;