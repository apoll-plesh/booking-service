// src/routes/resources.routes.js
// Маршруты каталога ресурсов. Все защищены JWT.
const express = require('express');
const { verifyToken } = require('../auth/middleware');
const {
  list,
  getById,
  availability,
} = require('../controllers/resources.controller');

const router = express.Router();

// Все маршруты требуют авторизации
router.use(verifyToken);

router.get('/', list);
router.get('/:id', getById);
router.get('/:id/availability', availability);

module.exports = router;