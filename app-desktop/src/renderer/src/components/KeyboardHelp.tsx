import { GLOBAL_SHORTCUTS } from '../hooks/useShortcuts';

function kbd(text: string) {
  return (
    <span className="inline-flex items-center gap-1">
      {text.split('+').map((k, i) => (
        <span key={i}>
          {i > 0 && <span className="text-gray-400 text-xs mx-0.5">+</span>}
          <kbd className="px-2 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-sm text-gray-700 dark:text-gray-300">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function formatShortcut(sc: (typeof GLOBAL_SHORTCUTS)[0]) {
  const parts: string[] = [];
  if (sc.ctrl)  parts.push('Ctrl');
  if (sc.shift) parts.push('Shift');
  if (sc.alt)   parts.push('Alt');
  parts.push(sc.key === 'Escape' ? 'Esc' : sc.key === ' ' ? 'Space' : sc.key);
  return parts.join('+');
}

interface Props {
  onClose: () => void;
  darkMode?: boolean;
}

export default function KeyboardHelp({ onClose, darkMode }: Props) {
  const groups = [...new Set(GLOBAL_SHORTCUTS.map(s => s.group || 'Other'))];

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col ${
        darkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <h2 className="text-xl font-bold">KB Keyboard Shortcuts</h2>
            <p className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Press <kbd className="px-1 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded font-mono">F1</kbd> or{' '}
              <kbd className="px-1 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded font-mono">Esc</kbd> to close
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {groups.map(group => (
            <div key={group}>
              <h3 className={`text-xs font-bold uppercase tracking-wider mb-3 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                {group}
              </h3>
              <div className="space-y-2">
                {GLOBAL_SHORTCUTS.filter(s => (s.group || 'Other') === group).map((sc, i) => (
                  <div key={i} className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`}>
                    <span className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{sc.description}</span>
                    {kbd(formatShortcut(sc))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t text-center ${darkMode ? 'border-gray-700 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
          <p className="text-xs">Shortcuts work globally. In text fields, use Ctrl+key shortcuts or F-keys.</p>
        </div>
      </div>
    </div>
  );
}
