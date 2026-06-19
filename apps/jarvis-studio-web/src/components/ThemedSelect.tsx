import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface OptionData {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

interface OptionElementProps {
  value?: string | number;
  children?: ReactNode;
  disabled?: boolean;
}

interface ThemedSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value' | 'defaultValue'> {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  placeholder?: string;
}

// 与 native <select> 对齐的轻量级下拉组件：保留原有 onChange({ target: { value } }) 调用方式，
// 弹出菜单完全自绘并使用暖色主题，避免依赖浏览器默认外观。
export function ThemedSelect({
  value,
  defaultValue,
  onChange,
  disabled,
  children,
  className,
  style,
  placeholder,
  name,
  id,
  required,
  'aria-label': ariaLabel
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<string>(
    defaultValue !== undefined ? String(defaultValue) : ''
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const reactId = useId();
  const componentId = id ?? `themed-select-${reactId}`;

  const isControlled = value !== undefined;
  const currentValue = isControlled ? String(value) : internalValue;

  // 解析 children 中的 <option> / <optgroup>，扁平化得到选项数组
  const options = useMemo<OptionData[]>(() => {
    const collected: OptionData[] = [];
    const visit = (nodes: ReactNode): void => {
      Children.forEach(nodes, (child) => {
        if (!isValidElement(child)) return;
        if (child.type === 'option') {
          const props = (child as ReactElement<OptionElementProps>).props;
          collected.push({
            value: String(props.value ?? ''),
            label: props.children ?? '',
            disabled: !!props.disabled
          });
          return;
        }
        const grandChildren = (child.props as { children?: ReactNode } | undefined)?.children;
        if (grandChildren) visit(grandChildren);
      });
    };
    visit(children);
    return collected;
  }, [children]);

  const selected = options.find((option) => option.value === currentValue) ?? null;

  // 关闭：点击外部 / Esc
  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        console.debug('[ThemedSelect] close via outside click');
        setOpen(false);
      }
    };
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        console.debug('[ThemedSelect] close via Escape');
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKeyboard);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKeyboard);
    };
  }, [open]);

  // 打开后让选中项滚入视野
  useEffect(() => {
    if (!open) return;
    const node = menuRef.current?.querySelector<HTMLLIElement>('[aria-selected="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const commitChange = useCallback(
    (next: OptionData) => {
      if (next.disabled) return;
      if (!isControlled) setInternalValue(next.value);
      onChange?.({ target: { value: next.value } });
      console.debug('[ThemedSelect] commit', { value: next.value });
      setOpen(false);
      triggerRef.current?.focus();
    },
    [isControlled, onChange]
  );

  // 键盘支持：方向键 / Enter / Home / End
  const handleTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === 'Home') {
        const first = options[0];
        if (first) {
          event.preventDefault();
          commitChange(first);
        }
        return;
      }
      if (event.key === 'End') {
        const last = options[options.length - 1];
        if (last) {
          event.preventDefault();
          commitChange(last);
        }
      }
    },
    [disabled, options, commitChange]
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (!options.length) return;
      const currentIndex = options.findIndex((option) => option.value === currentValue);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = currentIndex < 0 ? 0 : Math.min(options.length - 1, currentIndex + 1);
        const next = options[nextIndex];
        if (next) commitChange(next);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
        const next = options[nextIndex];
        if (next) commitChange(next);
      }
    },
    [currentValue, options, commitChange]
  );

  const triggerLabel = selected?.label ?? placeholder ?? '请选择';

  return (
    <div
      ref={wrapperRef}
      className={`themed-select${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <button
        ref={triggerRef}
        type="button"
        id={componentId}
        className="themed-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${componentId}-menu`}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="themed-select-value">{triggerLabel}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {/* 隐藏的 native select 用于 form 提交 / 表单 reset 兼容 */}
      {name ? (
        <select
          name={name}
          required={required}
          value={currentValue}
          onChange={() => {
            /* trigger 已通过 ThemedSelect 的 onChange 上报，这里仅占位避免 React 受控警告 */
          }}
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value}
            </option>
          ))}
        </select>
      ) : null}
      {open && !disabled ? (
        <ul
          ref={menuRef}
          id={`${componentId}-menu`}
          className="themed-select-menu"
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
        >
          {options.map((option) => {
            const isSelected = option.value === currentValue;
            return (
              <li
                key={`${option.value}-${String(option.label)}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled}
                className={`themed-select-option${isSelected ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
                onClick={() => commitChange(option)}
              >
                <span className="themed-select-check" aria-hidden="true">
                  {isSelected ? <Check size={12} /> : null}
                </span>
                <span className="themed-select-option-label">{option.label}</span>
              </li>
            );
          })}
          {options.length === 0 ? (
            <li className="themed-select-empty" role="presentation">无选项</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
