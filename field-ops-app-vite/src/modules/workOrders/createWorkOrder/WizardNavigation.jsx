// Pure step indicator -- no navigation logic of its own (CreateWorkOrderWizard.jsx
// owns stepIndex/goNext/goBack); this only renders which step is
// current/complete/upcoming.
export default function WizardNavigation({ steps, currentIndex }) {
  return (
    <ol className="fo-wizard-nav">
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={
            index === currentIndex
              ? "fo-wizard-nav-step fo-wizard-nav-step-active"
              : index < currentIndex
                ? "fo-wizard-nav-step fo-wizard-nav-step-done"
                : "fo-wizard-nav-step"
          }
        >
          {index + 1}. {step.label}
        </li>
      ))}
    </ol>
  );
}
