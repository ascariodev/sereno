import { act, render, screen } from '@testing-library/react-native';

import { MessageBody } from '@/components/MessageBody';
import { setLocale } from '@/i18n';
import { splitMentions } from '@/mentionToken';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));

const diego = { id: 12, name: 'Diego' };

beforeEach(() => {
  setLocale('en');
});

describe('splitMentions', () => {
  it('splits text and tokens, marking the own mention', () => {
    expect(splitMentions('Hi <@12> and <@7>!', [diego], 'user', 7)).toEqual([
      { text: 'Hi ' },
      { mention: 'Diego', own: false },
      { text: ' and ' },
      { mention: 'user', own: true },
      { text: '!' },
    ]);
  });

  it('does not treat invalid tokens as mentions', () => {
    for (const body of ['<@0>', '<@abc>', '<@012>', '<@>', '<@12', '@12>', '<@-1>', '<@1234567890123456789>']) {
      expect(splitMentions(body, [diego, { id: 0, name: 'Zero' }], 'user')).toEqual([{ text: body }]);
    }
  });
});

describe('MessageBody', () => {
  it('renders plain text with line breaks and no chips', async () => {
    await render(<MessageBody body={'Hello\n**world**'} mentions={[]} />);
    expect(screen.getByText('Hello\n**world**')).toBeOnTheScreen();
    expect(screen.queryAllByTestId('mention')).toHaveLength(0);
  });

  it('renders a null body as empty', async () => {
    await render(<MessageBody body={null} />);
    expect(screen.queryAllByTestId('mention')).toHaveLength(0);
  });

  it('turns tokens into chips, with the own variant and adjacent tokens', async () => {
    await render(<MessageBody body="Hi <@12><@7>, check this" mentions={[diego, { id: 7, name: 'Ana' }]} ownUserId={7} />);
    const chips = screen.getAllByTestId('mention');
    expect(chips.map((chip) => chip.props.children.join(''))).toEqual(['@Diego', '@Ana']);
    expect(screen.getByText('Hi @Diego@Ana, check this')).toBeOnTheScreen();
  });

  it('shows a translated label for a token without entry', async () => {
    await render(<MessageBody body="Hi <@99>" mentions={[diego]} />);
    expect(screen.getByText('Hi @user')).toBeOnTheScreen();
    await act(async () => {
      setLocale('es');
    });
    await render(<MessageBody body="Hola <@99>" mentions={[]} />);
    expect(screen.getByText('Hola @usuario')).toBeOnTheScreen();
  });
});
