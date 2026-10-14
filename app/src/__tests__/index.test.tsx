import { render, screen } from '@testing-library/react-native';

import Index from '@/app/index';

it('shows the app name', async () => {
  await render(<Index />);

  expect(screen.getByText('Sereno')).toBeOnTheScreen();
});
