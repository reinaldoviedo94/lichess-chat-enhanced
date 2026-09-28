const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

// La extensión MV3 no puede leer variables de entorno en runtime. API_BASE se
// hornea en el bundle en build-time por DefinePlugin: en CI/CD llega como secret
// API_BASE; en local (sin la variable) cae al backend de desarrollo.
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8000/api';

module.exports = {
  mode: 'development',
  devtool: 'cheap-module-source-map',
  entry: {
    content: './src/content/content.js',
    'popup/popup': './src/popup/popup.js',
    background: './src/background/background.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  plugins: [
    new webpack.DefinePlugin({
      __LCE_API_BASE__: JSON.stringify(API_BASE),
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'src/popup/popup.html', to: 'popup/popup.html' },
        { from: 'src/popup/popup.css', to: 'popup/popup.css' },
        { from: 'src/popup/tokens.css', to: 'popup/tokens.css' },
        { from: 'src/content/content.css', to: 'content.css' },
        { from: 'src/content/tokens.css', to: 'tokens.css' },
        { from: 'assets/icons', to: 'icons', noErrorOnMissing: true },
      ],
    }),
  ],
  optimization: {
    splitChunks: false, // No code splitting — CSP blocks dynamic chunks on Lichess
  },
  resolve: {
    extensions: ['.js'],
  },
};
