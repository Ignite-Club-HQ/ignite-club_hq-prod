import { CheckCircle, Home, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InviteFlowProgress } from "@/components/InviteFlowProgress";

interface PWAInstalledGuideProps {
  appName?: string;
  onDismiss?: () => void;
}

export function PWAInstalledGuide({ appName = "Ignite", onDismiss }: PWAInstalledGuideProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <InviteFlowProgress currentStep="install" className="fixed top-0 left-0 right-0" />
      <div className="flex-1 flex items-center justify-center p-4 pt-16">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle className="h-10 w-10 text-primary" />
            </div>
          </div>
          
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">App Installed!</h2>
            <p className="text-muted-foreground">
              {appName} has been added to your home screen.
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="font-medium text-sm">To continue:</p>
            <div className="flex items-center gap-3 text-left">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold text-sm">1</span>
              </div>
              <p className="text-sm">Close this browser tab</p>
            </div>
            <div className="flex items-center gap-3 text-left">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold text-sm">2</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span>Open</span>
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border">
                  <Home className="h-3 w-3" />
                  <span className="font-medium">{appName}</span>
                </div>
                <span>from home screen</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-left">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-primary font-semibold text-sm">3</span>
              </div>
              <p className="text-sm">Sign up and get started!</p>
            </div>
          </div>

          <div className="pt-2">
            <p className="text-xs text-muted-foreground">
              Your invite link will be remembered when you open the app.
            </p>
          </div>

          {onDismiss && (
            <Button variant="ghost" onClick={onDismiss} className="text-sm">
              Continue in browser instead
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
