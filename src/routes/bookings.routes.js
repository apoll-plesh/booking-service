// src/routes/bookings.routes.js
const express = require('express');
const { verifyToken } = require('../auth/middleware');
const { create, cancel, listMine } = require('../controllers/bookings.controller');

const router = express.Router();

router.use(verifyToken);

// POST /api/bookings — создание
router.post('/', create);

// GET /api/bookings/my — мои брони
router.get('/my', listMine);

// POST /api/bookings/:id/cancel — отмена
router.post('/:id/cancel', cancel);

module.exports = router;