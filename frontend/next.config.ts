import type { NextConfig } from "next";

const apiProxyTarget =
  process.env.API_PROXY_TARGET ?? "http://backend:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  // Convenience rewrite for local/container-internal frontend requests.
  // Production LAN auth demos must enter through Nginx on http://<LAN-IP>/ so
  // the backend receives trusted X-Forwarded-Host/Proto cookie context.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${apiProxyTarget}/uploads/:path*`,
      },
    ];
  },
};

export default nextConfig;
