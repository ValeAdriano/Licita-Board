import { render, screen } from '@testing-library/react-native';
import { FaixaAmbiente } from './FaixaAmbiente';

describe('FaixaAmbiente', () => {
  it('mostra DESENVOLVIMENTO em dev', async () => {
    await render(<FaixaAmbiente ambiente="dev" />);
    expect(screen.getByText('DESENVOLVIMENTO')).toBeTruthy();
  });

  it('mostra HOMOLOGAÇÃO em homolog', async () => {
    await render(<FaixaAmbiente ambiente="homolog" />);
    expect(screen.getByText('HOMOLOGAÇÃO')).toBeTruthy();
  });

  it('não mostra faixa em produção', async () => {
    await render(<FaixaAmbiente ambiente="prod" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
