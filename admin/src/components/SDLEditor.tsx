import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { SyntaxValidationResult } from '../types/collaboration';
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

interface SDLEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  validation?: SyntaxValidationResult | null;
  height?: number;
}

const KEYWORDS = ['type', 'interface', 'enum', 'input', 'union', 'scalar', 'extend', 'implements', 'directive', 'schema', 'query', 'mutation', 'subscription'];
const BUILTIN_TYPES = ['String', 'Int', 'Float', 'Boolean', 'ID', 'ID!', 'String!', 'Int!', 'Float!', 'Boolean!'];

const tokenizeSDL = (sdl: string): Array<{ type: string; value: string; start: number; end: number }> => {
  const tokens: Array<{ type: string; value: string; start: number; end: number }> = [];
  let i = 0;

  while (i < sdl.length) {
    const char = sdl[i];

    if (char === '#') {
      let end = i;
      while (end < sdl.length && sdl[end] !== '\n') {
        end++;
      }
      tokens.push({ type: 'comment', value: sdl.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = char;
      let end = i + 1;
      while (end < sdl.length && sdl[end] !== quote) {
        if (sdl[end] === '\\') end++;
        end++;
      }
      tokens.push({ type: 'string', value: sdl.slice(i, end + 1), start: i, end: end + 1 });
      i = end + 1;
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let end = i;
      while (end < sdl.length && /[a-zA-Z0-9_!]/.test(sdl[end])) {
        end++;
      }
      const word = sdl.slice(i, end);
      let type = 'field';

      if (KEYWORDS.includes(word)) {
        type = 'keyword';
      } else if (BUILTIN_TYPES.includes(word)) {
        type = 'builtin';
      } else if (/^[A-Z]/.test(word)) {
        type = 'typeName';
      } else if (sdl[end] === '(' || /^[a-z]/.test(word)) {
        type = 'field';
      }

      tokens.push({ type, value: word, start: i, end });
      i = end;
      continue;
    }

    if (/\s/.test(char)) {
      let end = i;
      while (end < sdl.length && /\s/.test(sdl[end])) {
        end++;
      }
      tokens.push({ type: 'whitespace', value: sdl.slice(i, end), start: i, end });
      i = end;
      continue;
    }

    if (/[{}[\]():=!@#$%^&*+\-<>?/\\|~`.,;]/.test(char)) {
      tokens.push({ type: 'punctuation', value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    tokens.push({ type: 'unknown', value: char, start: i, end: i + 1 });
    i++;
  }

  return tokens;
};

const LINE_NUMBER_WIDTH = 40;
const EDITOR_PADDING = 12;
const LINE_HEIGHT = 20;
const FONT_FAMILY = 'Monaco, Menlo, "Ubuntu Mono", Consolas, monospace';
const FONT_SIZE = 14;

const SDLEditor: React.FC<SDLEditorProps> = ({
  value,
  onChange,
  readOnly = false,
  validation = null,
  height = 400,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const tokens = useMemo(() => tokenizeSDL(value), [value]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    const lineNumbers = lineNumbersRef.current;
    if (!textarea) return;

    const { scrollTop, scrollLeft } = textarea;

    if (highlight) {
      highlight.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }

    if (lineNumbers) {
      lineNumbers.style.transform = `translateY(${-scrollTop}px)`;
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  const renderHighlightedCode = () => {
    const elements: React.ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let className = '';

      switch (token.type) {
        case 'keyword':
          className = 'sdl-keyword';
          break;
        case 'typeName':
        case 'builtin':
          className = 'sdl-type';
          break;
        case 'string':
          className = 'sdl-string';
          break;
        case 'comment':
          className = 'sdl-comment';
          break;
        case 'field':
          className = 'sdl-field';
          break;
        case 'punctuation':
          className = 'sdl-punctuation';
          break;
        default:
          className = '';
      }

      if (token.type === 'whitespace') {
        elements.push(<span key={i}>{token.value}</span>);
      } else {
        elements.push(
          <span key={i} className={className}>
            {token.value}
          </span>
        );
      }
    }
    return elements;
  };

  const lineCount = value.split('\n').length;

  return (
    <div className="sdl-editor-container">
      <div className="sdl-editor-wrapper" style={{ position: 'relative', height, overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#1e1e1e',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: LINE_NUMBER_WIDTH,
              bottom: 0,
              backgroundColor: '#252526',
              zIndex: 4,
              overflow: 'hidden',
            }}
          >
            <div
              ref={lineNumbersRef}
              style={{
                padding: `${EDITOR_PADDING}px 5px ${EDITOR_PADDING}px 0`,
                color: '#858585',
                fontFamily: FONT_FAMILY,
                fontSize: 12,
                lineHeight: `${LINE_HEIGHT}px`,
                textAlign: 'right',
                userSelect: 'none',
                willChange: 'transform',
              }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          </div>

          <div
            style={{
              position: 'absolute',
              top: 0,
              left: LINE_NUMBER_WIDTH,
              right: 0,
              bottom: 0,
              overflow: 'hidden',
              zIndex: 1,
            }}
          >
            <pre
              aria-hidden="true"
              style={{
                margin: 0,
                padding: `${EDITOR_PADDING}px`,
                color: '#d4d4d4',
                fontFamily: FONT_FAMILY,
                fontSize: FONT_SIZE,
                lineHeight: `${LINE_HEIGHT}px`,
                whiteSpace: 'pre',
                wordWrap: 'normal',
                pointerEvents: 'none',
              }}
            >
              <div
                ref={highlightRef}
                style={{ willChange: 'transform' }}
              >
                <code>{renderHighlightedCode()}</code>
              </div>
            </pre>
          </div>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onScroll={syncScroll}
          readOnly={readOnly}
          spellCheck={false}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            margin: 0,
            padding: `${EDITOR_PADDING}px ${EDITOR_PADDING}px ${EDITOR_PADDING}px ${LINE_NUMBER_WIDTH + EDITOR_PADDING}px`,
            width: '100%',
            height: '100%',
            backgroundColor: 'transparent',
            color: 'transparent',
            caretColor: '#d4d4d4',
            fontFamily: FONT_FAMILY,
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_HEIGHT}px`,
            border: 'none',
            outline: 'none',
            resize: 'none',
            zIndex: 5,
            overflow: 'auto',
            cursor: readOnly ? 'not-allowed' : 'text',
          }}
        />
      </div>

      <div className="sdl-editor-validation" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        backgroundColor: validation?.valid ? '#f6ffed' : '#fff1f0',
        border: `1px solid ${validation?.valid ? '#b7eb8f' : '#ffa39e'}`,
        borderRadius: '0 0 4px 4px',
        fontSize: '13px',
      }}>
        {validation?.valid ? (
          <>
            <CheckCircleOutlined style={{ color: '#52c41a' }} />
            <span style={{ color: '#52c41a' }}>SDL 语法正确</span>
          </>
        ) : validation?.errors ? (
          <>
            <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
            <span style={{ color: '#ff4d4f' }}>
              第 {validation.errors[0].line} 行第 {validation.errors[0].column} 列: {validation.errors[0].message}
            </span>
          </>
        ) : (
          <span style={{ color: '#8c8c8c' }}>正在校验...</span>
        )}
      </div>

      <style>{`
        .sdl-keyword {
          color: #569cd6;
          font-weight: bold;
        }
        .sdl-type {
          color: #4ec9b0;
        }
        .sdl-field {
          color: #d4d4d4;
        }
        .sdl-string {
          color: #ce9178;
        }
        .sdl-comment {
          color: #6a9955;
          font-style: italic;
        }
        .sdl-punctuation {
          color: #d4d4d4;
        }
      `}</style>
    </div>
  );
};

export default SDLEditor;
