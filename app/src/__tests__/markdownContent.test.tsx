import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { StyleSheet } from 'react-native';

import { setLocale } from '@/i18n';
import { MarkdownContent } from '@/markdown/MarkdownContent';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'en-US' }] }));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => true) }));

const diego = { id: 12, name: 'Diego' };

function styleOf(text: string) {
  return StyleSheet.flatten(screen.getByText(text).props.style);
}

beforeEach(() => {
  setLocale('en');
  jest.mocked(Linking.openURL).mockClear();
});

describe('MarkdownContent', () => {
  it('renders nothing for an empty source', async () => {
    await render(<MarkdownContent source="" />);
    expect(screen.toJSON()).toBeNull();
  });

  it('renders bold, italic and strikethrough', async () => {
    await render(<MarkdownContent source="a **bold** _it_ ~~gone~~" />);
    expect(styleOf('bold').fontWeight).toBe('700');
    expect(styleOf('it').fontStyle).toBe('italic');
    expect(styleOf('gone').textDecorationLine).toBe('line-through');
  });

  it('renders inline code and code blocks literally', async () => {
    await render(<MarkdownContent source={'Run `npm **test**`\n\n```\nconst a = 1;\n**x**\n```'} />);
    expect(styleOf('npm **test**').fontFamily).toBeDefined();
    expect(screen.getByText('const a = 1;\n**x**')).toBeOnTheScreen();
  });

  it('opens allowed links in the browser, including linkified URLs', async () => {
    await render(<MarkdownContent source="[docs](https://example.com/a) and https://sereno.dev" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    fireEvent.press(screen.getByText('docs'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/a');
  });

  it('does not make links of schemes outside http, https and mailto', async () => {
    await render(<MarkdownContent source="[file](file:///etc/passwd) [ftp](ftp://host/x) [js](javascript:alert(1))" />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fireEvent.press(screen.getByText('ftp'));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('keeps raw HTML as text', async () => {
    await render(<MarkdownContent source="<b>x</b>" />);
    expect(screen.getByText('<b>x</b>')).toBeOnTheScreen();
  });

  it('renders mentions as chips, with the unknown label and an escaped token as text', async () => {
    await render(<MarkdownContent source={'Hi **<@12>** <@99> \\<@12>'} mentions={[diego]} ownUserId={12} />);
    const chips = screen.getAllByTestId('mention');
    expect(chips.map((chip) => chip.props.children.join(''))).toEqual(['@Diego', '@user']);
    expect(StyleSheet.flatten(chips[0].props.style).fontWeight).toBe('600');
    expect(screen.getByText(/<@12>/)).toBeOnTheScreen();
  });

  it('leaves tokens as text without mentions', async () => {
    await render(<MarkdownContent source="Hi <@12>" />);
    expect(screen.queryAllByTestId('mention')).toHaveLength(0);
    expect(screen.getByText('Hi <@12>')).toBeOnTheScreen();
  });

  it('shifts headings and renders task items that toggle only when interactive', async () => {
    const onToggle = jest.fn();
    const source = '# Title\n\n- [ ] one\n- [x] two';
    await render(<MarkdownContent source={source} onToggle={onToggle} />);
    expect(screen.getByRole('header')).toHaveTextContent('Title');
    expect(styleOf('Title').fontSize).toBe(15);
    expect(screen.getByRole('checkbox', { name: 'two' })).toBeChecked();
    fireEvent.press(screen.getByRole('checkbox', { name: 'one' }));
    expect(onToggle).not.toHaveBeenCalled();

    await render(<MarkdownContent source={source} interactive onToggle={onToggle} />);
    fireEvent.press(screen.getByRole('checkbox', { name: 'two' }));
    expect(onToggle).toHaveBeenCalledWith(3);
  });
});
