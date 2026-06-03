import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        cart: resolve(__dirname, 'cart.html'),
        checkout: resolve(__dirname, 'checkout.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        delivery: resolve(__dirname, 'delivery.html'),
        kds: resolve(__dirname, 'kds.html'),
        payment: resolve(__dirname, 'payment.html')
      }
    }
  },
  esbuild: {
    drop: ['console', 'debugger']
  }
});
