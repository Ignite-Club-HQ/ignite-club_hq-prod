import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, AlertCircle, Download, Send, Users, Info, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";

type TeamRole = "player" | "parent" | "coach" | "team_admin";

interface ParsedChild {
  name: string;
  yearOfBirth: number | null;
}

interface ParsedMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  children: ParsedChild[];
}

interface ValidationError {
  row: number;
  message: string;
}

interface MemberCSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultRole: TeamRole;
  onImport: (members: ParsedMember[]) => void;
}

const VALID_ROLES: TeamRole[] = ["player", "parent", "coach", "team_admin"];

export function MemberCSVImportDialog({
  open,
  onOpenChange,
  defaultRole,
  onImport,
}: MemberCSVImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedMembers, setParsedMembers] = useState<ParsedMember[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);

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

  const validateAndParse = (content: string): { members: ParsedMember[]; errors: ValidationError[] } => {
    const lines = content.trim().split('\n').filter(line => line.trim());
    const members: ParsedMember[] = [];
    const errors: ValidationError[] = [];

    if (lines.length === 0) {
      errors.push({ row: 0, message: "File is empty" });
      return { members, errors };
    }

    // Check if first line is a header
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('name') || firstLine.includes('email');
    const startIndex = hasHeader ? 1 : 0;

    if (hasHeader) {
      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase());
      const nameIdx = header.findIndex(h => h.includes('name'));
      const emailIdx = header.findIndex(h => h.includes('email'));
      
      if (nameIdx === -1) {
        errors.push({ row: 1, message: "Missing 'name' column in header" });
      }
      
      // Validate header structure
      if (nameIdx !== 0) {
        errors.push({ row: 1, message: "Name should be the first column" });
      }
    }

    for (let i = startIndex; i < lines.length; i++) {
      const rowNum = i + 1;
      const values = parseCSVLine(lines[i]);

      const name = values[0]?.trim();
      const email = values[1]?.trim() || "";
      const roleFromCsv = values[2]?.trim().toLowerCase() || "";
      
      // Parse children from separate columns: child1_name, child1_yob, child2_name, child2_yob, child3_name, child3_yob
      const child1Name = values[3]?.trim() || "";
      const child1Yob = values[4]?.trim() || "";
      const child2Name = values[5]?.trim() || "";
      const child2Yob = values[6]?.trim() || "";
      const child3Name = values[7]?.trim() || "";
      const child3Yob = values[8]?.trim() || "";

      if (!name) {
        errors.push({ row: rowNum, message: "Name is required" });
        continue;
      }

      if (name.length > 100) {
        errors.push({ row: rowNum, message: "Name must be less than 100 characters" });
        continue;
      }

      // Validate email format if provided
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ row: rowNum, message: `Invalid email format: "${email}"` });
        continue;
      }

      // Parse and validate role
      let role: TeamRole = defaultRole;
      if (roleFromCsv) {
        if (VALID_ROLES.includes(roleFromCsv as TeamRole)) {
          role = roleFromCsv as TeamRole;
        } else {
          errors.push({ row: rowNum, message: `Invalid role "${roleFromCsv}". Valid: player, parent, coach, team_admin` });
          continue;
        }
      }

      // Build children array from separate columns
      const children: { name: string; yearOfBirth: number | null }[] = [];
      
      if (child1Name) {
        const yob = child1Yob ? parseInt(child1Yob) : null;
        if (child1Yob && (isNaN(yob!) || yob! < 1900 || yob! > new Date().getFullYear())) {
          errors.push({ row: rowNum, message: `Invalid year of birth for child 1: "${child1Yob}"` });
          continue;
        }
        children.push({ name: child1Name, yearOfBirth: yob });
      }
      
      if (child2Name) {
        const yob = child2Yob ? parseInt(child2Yob) : null;
        if (child2Yob && (isNaN(yob!) || yob! < 1900 || yob! > new Date().getFullYear())) {
          errors.push({ row: rowNum, message: `Invalid year of birth for child 2: "${child2Yob}"` });
          continue;
        }
        children.push({ name: child2Name, yearOfBirth: yob });
      }
      
      if (child3Name) {
        const yob = child3Yob ? parseInt(child3Yob) : null;
        if (child3Yob && (isNaN(yob!) || yob! < 1900 || yob! > new Date().getFullYear())) {
          errors.push({ row: rowNum, message: `Invalid year of birth for child 3: "${child3Yob}"` });
          continue;
        }
        children.push({ name: child3Name, yearOfBirth: yob });
      }

      // Warn if children specified for non-parent role
      if (children.length > 0 && role !== 'parent') {
        errors.push({ row: rowNum, message: `Children specified but role is "${role}" (not parent)` });
        continue;
      }

      members.push({
        id: crypto.randomUUID(),
        name,
        email,
        role,
        children,
      });
    }

    // Check for duplicate emails
    const emailCounts = new Map<string, number>();
    for (const member of members) {
      if (member.email) {
        const lower = member.email.toLowerCase();
        emailCounts.set(lower, (emailCounts.get(lower) || 0) + 1);
      }
    }
    for (const [email, count] of emailCounts) {
      if (count > 1) {
        errors.push({ row: 0, message: `Duplicate email: ${email} (${count} times)` });
      }
    }

    return { members, errors };
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
      
      const { members, errors: parseErrors } = validateAndParse(content);
      
      setFile(selectedFile);
      setParsedMembers(members);
      setErrors(parseErrors);
    };
    reader.readAsText(selectedFile);
  }, [toast, defaultRole]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    processFile(selectedFile);
    e.target.value = ""; // Reset input
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
    setParsedMembers([]);
    setErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImport = () => {
    if (parsedMembers.length === 0) return;
    
    onImport(parsedMembers);
    
    // Reset and close - toast will be shown by parent after invites are sent
    handleClear();
    onOpenChange(false);
  };

  const downloadTemplate = () => {
    const csvContent = `name,email,role,child1_name,child1_yob,child2_name,child2_yob,child3_name,child3_yob
John Smith,john@example.com,player,,,,,,
Jane Doe,jane@example.com,parent,Tommy,2016,Sally,2018,,
Mike Coach,mike@example.com,coach,,,,,,
Bob Parent,bob@example.com,parent,Jimmy,2015,,,,
Lisa Guardian,,parent,Emma,2017,Jack,2019,Lily,2020
Second Parent for Emma,parent2@example.com,parent,Emma,2017,,,,`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'team_members_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getRoleBadgeClass = (role: TeamRole) => {
    switch (role) {
      case 'player': return 'bg-amber-500/20 text-amber-600 border-amber-500/30';
      case 'parent': return 'bg-pink-500/20 text-pink-600 border-pink-500/30';
      case 'coach': return 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30';
      case 'team_admin': return 'bg-blue-500/20 text-blue-600 border-blue-500/30';
      default: return '';
    }
  };

  const hasBlockingErrors = errors.some(e => e.row > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Import Members
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk import team members
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden space-y-4">
          {/* Format Guide - Collapsible */}
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
                        <Badge className="text-xs">name</Badge>
                        <Badge variant="secondary" className="text-xs">email</Badge>
                        <Badge variant="secondary" className="text-xs">role</Badge>
                        <Badge variant="secondary" className="text-xs">child1_name</Badge>
                        <Badge variant="secondary" className="text-xs">child1_yob</Badge>
                        <Badge variant="secondary" className="text-xs">child2_name</Badge>
                        <Badge variant="secondary" className="text-xs">child2_yob</Badge>
                        <Badge variant="secondary" className="text-xs">child3_name</Badge>
                        <Badge variant="secondary" className="text-xs">child3_yob</Badge>
                      </div>
                    </div>
                    
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p><strong>name:</strong> Required - parent/member's full name</p>
                      <p><strong>email:</strong> Optional - for sending invites</p>
                      <p><strong>role:</strong> Optional - player, parent, coach, or team_admin</p>
                      <p><strong>child1_name, child1_yob:</strong> First child's name and year of birth</p>
                      <p><strong>child2_name, child2_yob:</strong> Second child (optional)</p>
                      <p><strong>child3_name, child3_yob:</strong> Third child (optional)</p>
                      <p className="text-primary/80 mt-1">💡 Multiple parents can reference the same child by using identical name + year of birth</p>
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

          {/* Using specific MIME types to prevent cloud picker defaults on mobile */}
          <input
            ref={fileInputRef}
            type="file"
            accept="text/csv,.csv"
            onChange={handleFileSelect}
            className="hidden"
          />

          {!file ? (
            <div className="space-y-3">
              {/* Download template button - prominent */}
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
            <div className="space-y-3">
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
                    <ul className="text-sm space-y-1">
                      {errors.slice(0, 3).map((error, i) => (
                        <li key={i}>{error.row > 0 ? `Row ${error.row}: ` : ''}{error.message}</li>
                      ))}
                      {errors.length > 3 && (
                        <li className="text-muted-foreground">+ {errors.length - 3} more issues</li>
                      )}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Members preview */}
              {parsedMembers.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">
                      {parsedMembers.length} member{parsedMembers.length !== 1 ? 's' : ''} found
                    </p>
                  </div>
                  <ScrollArea className="h-[200px] rounded-lg border">
                    <div className="p-2 space-y-1">
                      {parsedMembers.map((member) => (
                        <div 
                          key={member.id} 
                          className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{member.name}</p>
                            {member.email && (
                              <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                            )}
                            {member.children.length > 0 && (
                              <p className="text-xs text-primary truncate">
                                Children: {member.children.map(c => c.yearOfBirth ? `${c.name} (${c.yearOfBirth})` : c.name).join(', ')}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className={`shrink-0 text-xs ${getRoleBadgeClass(member.role)}`}>
                            {member.role}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* No valid members */}
              {parsedMembers.length === 0 && errors.length > 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <p className="text-sm">No valid members found</p>
                  <p className="text-xs">Please fix the errors above and try again</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            className="flex-1" 
            onClick={handleImport}
            disabled={parsedMembers.length === 0 || hasBlockingErrors}
          >
            <Send className="h-4 w-4 mr-2" />
            Send Invites {parsedMembers.length > 0 ? `(${parsedMembers.length})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
