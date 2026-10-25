// src/routes/bookings.routes.js
// Маршруты бронирования. Все защищены JWT.
const express = require('express');
const { verifyToken } = require('../auth/middleware');
const { create } = require('../controllers/bookings.controller');

const router = express.Router();

router.use(verifyToken);

// POST /api/bookings — создание брони для текущего пользователя
router.post('/', create);

module.exports = router;