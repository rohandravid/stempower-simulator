// UI strings live here so a Hindi translation is a dictionary away.
export const STR = {
  appTitle: 'StemPower Lab',
  appTagline: 'Learn electronics by building',

  // Toolbar
  toolbarRun: 'Run',
  toolbarStop: 'Stop',
  toolbarExamples: 'Projects',
  toolbarClear: 'Clear',
  clearConfirm: 'Remove every part and wire from the board?',
  statusReady: 'Ready',
  statusRunning: 'Running',
  statusError: 'Error',
  projectsMenuTitle: 'Guided projects',
  projectsMenuSubtitle: 'Build a project step by step, or open the finished version.',
  projectsBuildIt: 'Build step by step',
  projectsOpenFinished: 'Open finished',

  // Tutorial panel
  tutorialTitle: 'Tutorial',
  tutorialStepOf: 'Step {i} of {n}',
  tutorialBack: 'Back',
  tutorialNext: 'Next',
  tutorialFinish: 'Finish 🎉',
  tutorialSkip: 'Skip this step',
  tutorialExit: 'Exit tutorial',
  tutorialCheckDone: 'Nice work! Press Next to continue.',
  tutorialInsertCode: '⤵ Put this code in the editor',

  // Tabs
  tabCode: 'Code',
  tabSerial: 'Serial Monitor',
  tabAiHelper: 'Spark · AI Tutor',

  // Serial monitor
  serialTitle: 'Serial Monitor',
  serialClear: 'Clear',
  serialPlaceholder: 'Serial output will appear here — try Serial.println() in your code.',

  // Diagnostics
  diagTitle: 'Circuit check',
  diagCodeErrorPrefix: 'Code error',
  diagStoppedPrefix: 'Stopped',
  diagEmpty: 'All clear! Your wiring looks good — press Run to bring it to life.',

  // Palette
  paletteTitle: 'Parts',
  paletteGroupBasics: 'Basics',
  paletteGroupSensors: 'Sensors',
  paletteGroupPower: 'Power & motion',
  paletteLed: 'LED',
  paletteResistor: 'Resistor',
  paletteButton: 'Push button',
  paletteKnob: 'Knob (pot)',
  paletteLm393: 'Soil moisture',
  paletteDht11: 'Temp & humidity',
  paletteRadar: 'Speed sensor',
  paletteL298n: 'Motor driver',
  paletteMotor: 'DC motor',
  paletteBattery: '9V battery',
  paletteSelectionTitle: 'Selected part',
  paletteDelete: 'Delete',
  paletteFlip: 'Flip LED',
  paletteHint: 'Tap a hole, then another hole to add a wire. Tap a part to select it, drag it to move.',

  // Canvas
  canvasWireHint: 'Tap another hole to connect',

  // Assistant
  assistantName: 'Spark',
  assistantRole: 'Your AI lab partner',
  assistantPlaceholder: 'Ask Spark for a hint…',
  assistantSend: 'Send',
  assistantNote: 'Spark can make mistakes. Check important info.',
  assistantWelcome:
    "Hi, I'm Spark! Ask me a question about your circuit or code, or try one of the buttons below.",
  assistantQuickDebug: '🐛 Help me debug',
  assistantQuickDebugMessage: "My circuit or code isn't working the way I expect. Can you help me figure out why?",
  assistantQuickProject: '💡 Suggest a project',
  assistantQuickProjectMessage: 'Can you suggest a fun small project I can build with the parts in this simulator?',
  assistantTyping: '…',
  assistantUnavailable:
    "Spark isn't set up on this computer yet — the AI tutor server needs an ANTHROPIC_API_KEY. The simulator works great without it!",
  assistantError: 'Something went wrong. Please try again.',
} as const;
