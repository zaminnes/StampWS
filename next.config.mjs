/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/showcase": ["./app/api/admin/showcase/_assets/stampws-showcase.html"],
    "/api/admin/showcase": ["./app/api/admin/showcase/_assets/stampws-showcase.html"],
    "/api/admin/showcase/assets": ["./app/api/admin/showcase/_assets/*"]
  },
  outputFileTracingExcludes: {
    "/showcase": [
      "./.data/**/*",
      "./AI_KIOSK_Voice/**/*",
      "./오답노터_files/**/*",
      "./오답노터.html",
      "./오답노터_files/**/*",
      "./오답노터.html",
      "./SW.mp4",
      "./James.mp4"
    ],
    "/api/admin/showcase": [
      "./.data/**/*",
      "./AI_KIOSK_Voice/**/*",
      "./오답노터_files/**/*",
      "./오답노터.html",
      "./오답노터_files/**/*",
      "./오답노터.html",
      "./SW.mp4",
      "./James.mp4"
    ],
    "/api/admin/showcase/assets": [
      "./.data/**/*",
      "./AI_KIOSK_Voice/**/*",
      "./오답노터_files/**/*",
      "./오답노터.html",
      "./오답노터_files/**/*",
      "./오답노터.html",
      "./SW.mp4",
      "./James.mp4"
    ]
  },
  turbopack: {
    root: process.cwd()
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=()"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
