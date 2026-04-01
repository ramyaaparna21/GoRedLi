const path = require('path')
const CopyPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')

const API_URL = process.env.API_URL || 'https://REPLACE_WITH_API_URL'
const ADMIN_APP_URL = process.env.ADMIN_APP_URL || 'https://REPLACE_WITH_ADMIN_URL'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'REPLACE_WITH_CLIENT_ID'
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'REPLACE_WITH_CLIENT_SECRET'

module.exports = {
  entry: {
    background: './src/background.ts',
    popup: './src/popup/popup.ts',
    redirect: './src/redirect.ts',
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
        ...(require('fs').existsSync(path.resolve(__dirname, 'icons'))
          ? [{ from: 'icons', to: 'icons' }]
          : []),
      ],
    }),
  ],
}
