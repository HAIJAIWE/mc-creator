import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlineSearch } from './OutlineSearch';

describe('OutlineSearch', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onClear: vi.fn(),
    totalCount: 10,
    filteredCount: 10,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders search input with placeholder', () => {
    render(<OutlineSearch {...defaultProps} />);

    const input = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'search');
  });

  it('shows search icon', () => {
    render(<OutlineSearch {...defaultProps} />);

    const searchIcon = screen.getByLabelText('search').closest('span');
    expect(searchIcon).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    render(<OutlineSearch {...defaultProps} />);

    const input = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    fireEvent.change(input, { target: { value: 'test' } });

    expect(defaultProps.onChange).toHaveBeenCalledWith('test');
  });

  it('shows clear button when value is not empty', () => {
    render(<OutlineSearch {...defaultProps} value="test" />);

    const clearButton = screen.getByLabelText('清空搜索');
    expect(clearButton).toBeInTheDocument();
  });

  it('hides clear button when value is empty', () => {
    render(<OutlineSearch {...defaultProps} value="" />);

    expect(screen.queryByLabelText('清空搜索')).not.toBeInTheDocument();
  });

  it('calls onClear when clear button clicked', () => {
    render(<OutlineSearch {...defaultProps} value="test" />);

    const clearButton = screen.getByLabelText('清空搜索');
    fireEvent.click(clearButton);

    expect(defaultProps.onClear).toHaveBeenCalled();
  });

  it('shows count when filtering', () => {
    render(<OutlineSearch {...defaultProps} value="test" filteredCount={3} totalCount={10} />);

    expect(screen.getByText('3 / 10')).toBeInTheDocument();
  });

  it('hides count when value is empty', () => {
    render(<OutlineSearch {...defaultProps} value="" filteredCount={3} totalCount={10} />);

    expect(screen.queryByText('3 / 10')).not.toBeInTheDocument();
  });

  it('clears on Escape key', () => {
    render(<OutlineSearch {...defaultProps} value="test" />);

    const input = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(defaultProps.onClear).toHaveBeenCalled();
  });

  it('shows keyboard shortcut hint when not focused and empty', () => {
    render(<OutlineSearch {...defaultProps} value="" />);

    // The shortcut hint is only visible on larger screens (xs:inline-flex)
    // In test environment it might not be visible due to CSS
    // But we can check it exists in the DOM
    const kbd = screen.getByText('⌘F');
    expect(kbd).toBeInTheDocument();
  });

  it('hides keyboard shortcut when focused', () => {
    render(<OutlineSearch {...defaultProps} value="" />);

    const input = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    fireEvent.focus(input);

    // The kbd should have hidden class when focused
    const kbd = screen.getByText('⌘F').closest('kbd');
    expect(kbd).toHaveClass('hidden');
  });

  it('uses custom placeholder when provided', () => {
    render(<OutlineSearch {...defaultProps} placeholder="自定义搜索" />);

    expect(screen.getByPlaceholderText('自定义搜索')).toBeInTheDocument();
  });

  it('has correct aria attributes', () => {
    render(<OutlineSearch {...defaultProps} value="test" filteredCount={3} totalCount={10} />);

    const input = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    expect(input).toHaveAttribute('aria-label', '搜索节点');
    expect(input).toHaveAttribute('aria-describedby', 'outline-search-count');
    expect(input).toHaveAttribute('autoComplete', 'off');
    expect(input).toHaveAttribute('spellCheck', 'false');
  });
});