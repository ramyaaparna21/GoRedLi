const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')

// Load .env file if present (install: npm i -D dotenv)
try { require('dotenv').config() } catch { /* dotenv not installed — rely on shell env */ }

const REQUIRED_VARS = ['API_URL', 'ADMIN_APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
const missing = REQUIRED_VARS.filter(v => !process.env[v])
if (missing.length > 0) {
  console.error('\n\x1b[31mBuild failed: missing required environment variables:\x1b[0m')
  missing.forEach(v => console.error(`  - ${v}`))
  console.error('\nCopy extension/.env.example to extension/.env and fill in the values.\n')
  process.exit(1)
}

const API_URL = process.env.API_URL
const ADMIN_APP_URL = process.env.ADMIN_APP_URL
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

module.exports = {
  entry: {
    background: './src/background.ts',
    popup: './src/popup/popup.ts',
    redirect: './src/redirect.ts',
    popular: './src/popular.ts',
    content: './src/content.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  plugins: [
    new webpack.DefinePlugin({
      __API_URL__: JSON.stringify(API_URL),
      __ADMIN_APP_URL__: JSON.stringify(ADMIN_APP_URL),
      __GOOGLE_CLIENT_ID__: JSON.stringify(GOOGLE_CLIENT_ID),
      __GOOGLE_CLIENT_SECRET__: JSON.stringify(GOOGLE_CLIENT_SECRET),
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
        { from: 'src/popup/popup.html', to: 'popup/' },
        { from: 'src/popup/popup.css', to: 'popup/' },
        { from: 'src/redirect/redirect.html', to: 'redirect/' },
        { from: 'src/popular/popular.html', to: 'popular/' },
        ...(require('fs').existsSync(path.resolve(__dirname, 'icons'))
          ? [{ from: 'icons', to: 'icons' }]
          : []),
      ],
    }),
  ],
}
