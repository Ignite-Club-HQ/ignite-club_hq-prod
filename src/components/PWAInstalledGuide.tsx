import { CheckCircle, Home, ArrowRight, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InviteFlowProgress } from "@/components/InviteFlowProgress";
import igniteIcon from "@/assets/ignite-icon.png";

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

          {/* App icon preview - so users know what to look for */}
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
              <img 
                src="/ignite-logo.png" 
                alt={`${appName} app icon`}
                className="h-16 w-16 rounded-xl"
              />
            </div>
            <p className="text-xs text-muted-foreground">Look for this icon on your home screen</p>
          </div>

          {/* Clear next steps */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-4">
            <p className="font-semibold text-primary">Next steps:</p>
            <div className="flex items-start gap-3 text-left">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <X className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <p className="font-medium">Close this browser</p>
                <p className="text-sm text-muted-foreground">Swipe up or tap the X to close</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-left">
              <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <Home className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <p className="font-medium">Open {appName} from home screen</p>
                <p className="text-sm text-muted-foreground">Tap the {appName} icon you just installed</p>
              </div>
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
