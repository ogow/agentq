'use strict';

const gts = require('gts');

module.exports = [
  ...gts,
  {
    ignores: [
      'coverage/',
      'dist/',
      'node_modules/',
    ],
  },
];
