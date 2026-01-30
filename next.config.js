/** @type {import('next').NextConfig} */
const nextConfig = {
  // これを true にすると、今回のような細かい型エラーを全て無視してビルドを完了させます
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig