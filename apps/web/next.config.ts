import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El lint corre desde la raíz del monorepo (`pnpm lint`), con las reglas compartidas.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
