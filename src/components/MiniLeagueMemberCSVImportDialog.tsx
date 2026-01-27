import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, AlertCircle, Download, Send, Info, ChevronDown, Mail, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface ParsedPlayer {
  id: string;
  name: string;
  abilityRating: string;
  parentName: string;
  parentEmail: string;
}

interface ValidationError {
  row: number;
  message: string;
}

interface MiniLeagueMemberCSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (players: ParsedPlayer[]) => void;
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const abilityOptions = [
  { value: "1", label: "1 - Beginner" },
  { value: "2", label: "2 - Developing" },
  { value: "3", label: "3 - Intermediate" },
  { value: "4", label: "4 - Advanced" },
  { value: "5", label: "5 - Expert" },
];

export function MiniLeagueMemberCSVImportDialog({
  open,
  onOpenChange,
  onImport,
}: MiniLeagueMemberCSVImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedPlayers, setParsedPlayers] = useState<ParsedPlayer[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);

  const updatePlayerField = (playerId: string, field: keyof ParsedPlayer, value: string) => {
    setParsedPlayers(prev => 
      prev.map(p => p.id === playerId ? { ...p, [field]: value } : p)
    );
  };

  const isPlayerValid = (player: ParsedPlayer) => {
    return player.name.trim().length > 0 && 
           (!player.parentEmail || isValidEmail(player.parentEmail));
  };

  const allPlayersValid = parsedPlayers.every(isPlayerValid);
  const invalidCount = parsedPlayers.filter(p => !isPlayerValid(p)).length;

  const parseCSVLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const validateAndParse = (content: string): { players: ParsedPlayer[]; errors: ValidationError[] } => {
    const lines = content.trim().split('\n').filter(line => line.trim());
    const players: ParsedPlayer[] = [];
    const errors: ValidationError[] = [];

    if (lines.length === 0) {
      errors.push({ row: 0, message: "File is empty" });
      return { players, errors };
    }

    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('player') || firstLine.includes('name');
    const startIndex = hasHeader ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const rowNum = i + 1;
      const values = parseCSVLine(lines[i]);

      const name = values[0]?.trim();
      const abilityStr = values[1]?.trim() || "3";
      const parentName = values[2]?.trim() || "";
      const parentEmail = values[3]?.trim() || "";

      if (!name) {
        errors.push({ row: rowNum, message: "Player name is required" });
        continue;
      }

      if (name.length > 100) {
        errors.push({ row: rowNum, message: "Name must be less than 100 characters" });
        continue;
      }

      // Validate ability rating
      const abilityNum = parseInt(abilityStr);
      if (isNaN(abilityNum) || abilityNum < 1 || abilityNum > 5) {
        errors.push({ row: rowNum, message: `Invalid ability rating "${abilityStr}". Must be 1-5` });
        continue;
      }

      // Validate email if provided
      if (parentEmail && !isValidEmail(parentEmail)) {
        errors.push({ row: rowNum, message: `Invalid email format: "${parentEmail}"` });
        continue;
      }

      players.push({
        id: crypto.randomUUID(),
        name,
        abilityRating: abilityNum.toString(),
        parentName,
        parentEmail,
      });
    }

    // Check for duplicate emails
    const emailCounts = new Map<string, number>();
    for (const player of players) {
      if (player.parentEmail) {
        const lower = player.parentEmail.toLowerCase();
        emailCounts.set(lower, (emailCounts.get(lower) || 0) + 1);
      }
    }
    for (const [email, count] of emailCounts) {
      if (count > 1) {
        errors.push({ row: 0, message: `Duplicate email: ${email} (${count} times)` });
      }
    }

    return { players, errors };
  };

  const processFile = useCallback((selectedFile: File) => {
    const fileName = selectedFile.name.toLowerCase();
    
    if (!fileName.endsWith('.csv')) {
      toast({
        title: "Invalid file",
        description: "Please select a CSV file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      
      const { players, errors: parseErrors } = validateAndParse(content);
      
      setFile(selectedFile);
      setParsedPlayers(players);
      setErrors(parseErrors);
    };
    reader.readAsText(selectedFile);
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    processFile(selectedFile);
    e.target.value = "";
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  }, [processFile]);

  const handleClear = () => {
    setFile(null);
    setParsedPlayers([]);
    setErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImport = () => {
    if (parsedPlayers.length === 0) return;
    onImport(parsedPlayers);
    handleClear();
    onOpenChange(false);
  };

  const downloadTemplate = () => {
    const csvContent = `player_name,ability_rating,parent_name,parent_email
Tommy Smith,3,John Smith,john@example.com
Emma Jones,4,Sarah Jones,sarah@example.com
Jack Wilson,2,Mike Wilson,
Lucy Brown,5,Kate Brown,kate@example.com`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mini_league_players_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasBlockingErrors = errors.some(e => e.row > 0);

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent fullScreen className="sm:max-w-md max-h-[90vh] flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Import Players
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Upload a CSV file to bulk import players
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Format Guide */}
          <Collapsible open={formatOpen} onOpenChange={setFormatOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between h-10">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  <span className="text-sm">CSV format guide</span>
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${formatOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Columns</p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge className="text-xs">player_name</Badge>
                        <Badge variant="secondary" className="text-xs">ability_rating</Badge>
                        <Badge variant="secondary" className="text-xs">parent_name</Badge>
                        <Badge variant="secondary" className="text-xs">parent_email</Badge>
                      </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p><strong>player_name:</strong> Required - child's name</p>
                      <p><strong>ability_rating:</strong> 1-5 (1=Beginner, 5=Expert)</p>
                      <p><strong>parent_name:</strong> Optional - parent's name</p>
                      <p><strong>parent_email:</strong> Optional - for sending invites</p>
                    </div>
                  </div>

                  <Button variant="outline" size="sm" className="w-full" onClick={downloadTemplate}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Download template
                  </Button>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          <input
            ref={fileInputRef}
            type="file"
            accept="text/csv,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!file ? (
            <div className="space-y-3">
              <Button variant="outline" className="w-full" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Download CSV Template
              </Button>

              <Card 
                className={`border-2 border-dashed transition-all cursor-pointer ${
                  isDragging 
                    ? 'border-primary bg-primary/5' 
                    : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <CardContent className="py-8">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className={`rounded-full p-3 transition-colors ${
                      isDragging ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      <Upload className={`h-6 w-6 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {isDragging ? 'Drop file here' : 'Tap to upload CSV'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        or drag and drop
                      </p>
                    </div>
                    <Badge variant="secondary">.csv</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
              {/* File info */}
              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium truncate">{file.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={handleClear}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Errors */}
              {errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <ul className="list-disc list-inside text-xs">
                      {errors.slice(0, 3).map((err, idx) => (
                        <li key={idx}>
                          {err.row > 0 && `Row ${err.row}: `}{err.message}
                        </li>
                      ))}
                      {errors.length > 3 && (
                        <li>...and {errors.length - 3} more errors</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Preview */}
              {parsedPlayers.length > 0 && (
                <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">
                      {parsedPlayers.length} player{parsedPlayers.length !== 1 ? 's' : ''} found
                    </span>
                    {invalidCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {invalidCount} invalid
                      </Badge>
                    )}
                  </div>

                  <ScrollArea className="flex-1 min-h-0">
                    <div className="space-y-2 pr-4">
                      {parsedPlayers.map((player, idx) => {
                        const isValid = isPlayerValid(player);
                        return (
                          <div 
                            key={player.id}
                            className={`p-3 rounded-lg border ${
                              isValid ? 'bg-muted/50' : 'bg-destructive/10 border-destructive/50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant="outline" className="text-xs">#{idx + 1}</Badge>
                              <div className="flex items-center gap-1">
                                {Array.from({ length: parseInt(player.abilityRating) }).map((_, i) => (
                                  <Star key={i} className="h-3 w-3 fill-amber-400 text-amber-400" />
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                placeholder="Player name *"
                                value={player.name}
                                onChange={(e) => updatePlayerField(player.id, "name", e.target.value)}
                                className={!player.name.trim() ? 'border-destructive' : ''}
                              />
                              <Select
                                value={player.abilityRating}
                                onValueChange={(v) => updatePlayerField(player.id, "abilityRating", v)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {abilityOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {(player.parentName || player.parentEmail) && (
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <Input
                                  placeholder="Parent name"
                                  value={player.parentName}
                                  onChange={(e) => updatePlayerField(player.id, "parentName", e.target.value)}
                                />
                                <Input
                                  type="email"
                                  placeholder="Parent email"
                                  value={player.parentEmail}
                                  onChange={(e) => updatePlayerField(player.id, "parentEmail", e.target.value)}
                                  className={player.parentEmail && !isValidEmail(player.parentEmail) ? 'border-destructive' : ''}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {file && parsedPlayers.length > 0 && (
          <div className="pt-4 border-t">
            <Button
              className="w-full"
              onClick={handleImport}
              disabled={hasBlockingErrors || !allPlayersValid}
            >
              <Send className="h-4 w-4 mr-2" />
              Add {parsedPlayers.length} Player{parsedPlayers.length !== 1 ? 's' : ''} & Send Invites
            </Button>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
