import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests so one test's DOM cannot leak into the next.
afterEach(() => {
  cleanup();
});
