"""Fail-closed PostgreSQL AST checks for release-time statements, not runtime bodies."""
import json
import sys
from pglast import parser

ALLOWED = {
    'CreateStmt', 'CreateSchemaStmt', 'CreateFunctionStmt', 'CreateTrigStmt',
    'CreatePolicyStmt', 'AlterPolicyStmt', 'GrantStmt', 'GrantRoleStmt',
    'IndexStmt', 'CompositeTypeStmt', 'CreateEnumStmt', 'AlterEnumStmt',
    'CommentStmt', 'AlterTableStmt', 'DropStmt',
}

def check(sql):
    issues = []
    for raw in json.loads(parser.parse_sql_json(sql))['stmts']:
        statement = raw['stmt']
        kind = next(iter(statement))
        body = statement[kind]
        if kind not in ALLOWED:
            issues.append(f'{kind}: not a structural release statement')
        if kind == 'CreateStmt' and (body.get('inhRelations') or body.get('ofTypename')):
            issues.append('Inherited/typed tables require separate review')
        if kind == 'AlterTableStmt':
            for command in body.get('cmds', []):
                subtype = command.get('AlterTableCmd', {}).get('subtype')
                if subtype not in {'AT_AddColumn', 'AT_AddConstraint', 'AT_EnableRowSecurity',
                                   'AT_ForceRowSecurity', 'AT_ColumnDefault', 'AT_SetNotNull',
                                   'AT_DropNotNull', 'AT_ValidateConstraint'}:
                    issues.append(f'{subtype}: table alteration requires separate review')
        if kind == 'DropStmt' and body.get('removeType') not in {'OBJECT_POLICY', 'OBJECT_TRIGGER', 'OBJECT_FUNCTION'}:
            issues.append('Dropping stored structures is forbidden')
        if kind == 'CreateFunctionStmt' and body.get('is_procedure'):
            issues.append('Procedures require separate review')
        # Outside stored function definitions, a query or function expression can
        # perform writes indirectly (defaults, constraints, policy expressions).
        def walk(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in {'InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt', 'SelectStmt', 'SubLink'}:
                        issues.append(f'{key}: release-time query requires separate review')
                    if key == 'FuncCall':
                        name = '.'.join(part.get('String', {}).get('sval', '') for part in item.get('funcname', []))
                        if name not in {'auth.uid', 'auth.role', 'now', 'gen_random_uuid', 'public.gen_random_uuid'}:
                            issues.append(f'Function expression {name}: requires separate review')
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)
        if kind != 'CreateFunctionStmt':
            walk(body)
    return issues

if __name__ == '__main__':
    try:
        files = json.load(sys.stdin)
        issues = [f'{name}: {issue}' for name, sql in files.items() for issue in check(sql)]
        print(json.dumps(issues))
        sys.exit(1 if issues else 0)
    except Exception as error:
        print(json.dumps([f'SQL inspection failed: {type(error).__name__}']))
        sys.exit(1)