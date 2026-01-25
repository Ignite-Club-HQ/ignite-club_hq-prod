import { useState, useEffect } from "react";
import { Share, PlusSquare, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface IOSInstallGuideProps {
  onComplete?: () => void;
  compact?: boolean;
}

const steps = [
  {
    id: 1,
    icon: Share,
    title: "Tap the Share button",
    description: "Look for the Share icon at the bottom of Safari",
    arrowPosition: "bottom" as const,
  },
  {
    id: 2,
    icon: PlusSquare,
    title: 'Tap "Add to Home Screen"',
    description: "Scroll down in the share menu to find this option",
    arrowPosition: "center" as const,
  },
  {
    id: 3,
    icon: Check,
    title: 'Tap "Add"',
    description: "Confirm to add the app to your home screen",
    arrowPosition: "top" as const,
  },
];

export function IOSInstallGuide({ onComplete, compact = false }: IOSInstallGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);

  // Auto-advance through steps for demo effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % steps.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Pulse animation reset
  useEffect(() => {
    setIsAnimating(false);
    const timeout = setTimeout(() => setIsAnimating(true), 50);
    return () => clearTimeout(timeout);
  }, [currentStep]);

  const activeStep = steps[currentStep];

  if (compact) {
    return (
      <div className="space-y-3 bg-muted/50 rounded-lg p-4">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="flex gap-1">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={cn(
                  "w-2 h-2 rounded-full transition-all duration-300",
                  index === currentStep
                    ? "bg-primary w-6"
                    : index < currentStep
                    ? "bg-primary/50"
                    : "bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
        </div>

        <div className="relative min-h-[80px] flex items-center justify-center">
          <div
            key={currentStep}
            className="text-center animate-fade-in"
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                {activeStep.id}
              </span>
              <activeStep.icon
                className={cn(
                  "h-5 w-5 text-primary",
                  isAnimating && "animate-pulse"
                )}
              />
            </div>
            <p className="text-sm font-medium">{activeStep.title}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeStep.description}
            </p>
          </div>
        </div>

        {/* Bouncing arrow pointing to Share button location */}
        {currentStep === 0 && (
          <div className="flex justify-center pt-2">
            <ChevronDown
              className={cn(
                "h-6 w-6 text-primary",
                isAnimating && "animate-bounce"
              )}
            />
          </div>
        )}

        {/* Step indicators - clickable */}
        <div className="flex justify-center gap-4 pt-2">
          {steps.map((step, index) => (
            <button
              key={step.id}
              onClick={() => setCurrentStep(index)}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200",
                index === currentStep
                  ? "bg-primary text-primary-foreground scale-110"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              <step.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div className="flex gap-1">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-500",
              index === currentStep
                ? "bg-primary"
                : index < currentStep
                ? "bg-primary/50"
                : "bg-muted"
            )}
          />
        ))}
      </div>

      {/* Current step display */}
      <div className="relative bg-gradient-to-b from-primary/10 to-transparent rounded-xl p-6 min-h-[160px]">
        <div
          key={currentStep}
          className="flex flex-col items-center text-center animate-fade-in"
        >
          {/* Step number badge */}
          <div
            className={cn(
              "flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground mb-3 transition-transform",
              isAnimating && "animate-scale-in"
            )}
          >
            <activeStep.icon className="h-6 w-6" />
          </div>

          {/* Step content */}
          <h4 className="font-semibold text-lg mb-1">{activeStep.title}</h4>
          <p className="text-sm text-muted-foreground">{activeStep.description}</p>

          {/* Visual pointer for step 1 */}
          {currentStep === 0 && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 flex flex-col items-center">
              <div className="w-0.5 h-8 bg-gradient-to-b from-primary to-transparent" />
              <ChevronDown
                className={cn(
                  "h-8 w-8 text-primary -mt-2",
                  isAnimating && "animate-bounce"
                )}
              />
              <span className="text-xs text-primary font-medium mt-1 bg-background px-2 py-0.5 rounded">
                Share button is here ↓
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Step navigation */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {steps.map((step, index) => (
            <button
              key={step.id}
              onClick={() => setCurrentStep(index)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                index === currentStep
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              <step.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Step {step.id}</span>
            </button>
          ))}
        </div>

        {onComplete && (
          <Button size="sm" variant="ghost" onClick={onComplete}>
            Got it
          </Button>
        )}
      </div>
    </div>
  );
}
