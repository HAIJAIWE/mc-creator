interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

/** 搜索输入框（带放大镜图标） */
export function SearchInput({ value, onChange, placeholder = '搜索…' }: SearchInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-mc-mute">
        🔍
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mc-input w-full !py-1 !pl-7 !text-xs"
      />
    </div>
  );
}
