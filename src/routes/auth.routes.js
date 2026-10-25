// src/routes/auth.routes.js
// Маршруты аутентификации.
const express = require('express');
const { signin } = require('../controllers/auth.controller');

const router = express.Router();

// POST /api/auth/signin — вход, выдача JWT
router.post('/signin', signin);

module.exports = router;