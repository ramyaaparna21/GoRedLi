package db

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

type Store struct {
	client *dynamodb.Client
	table  string
}

func NewStore(client *dynamodb.Client, table string) *Store {
	return &Store{client: client, table: table}
}

// ── Key helpers ───────────────────────────────────────────────────────────────

func userPK(id string) string        { return "USER#" + id }
func gsubPK(sub string) string       { return "GSUB#" + sub }
func emailPK(email string) string    { return "EMAIL#" + email }
func wsPK(id string) string          { return "WS#" + id }
func memSK(id string) string         { return "MEM#" + id }
func linkSK(id string) string        { return "LINK#" + id }
func aliasSK(alias string) string    { return "ALIAS#" + alias }
func gsi1UserMem(uid string) string  { return "UMEM#" + uid }
func gsi1PreMem(email string) string { return "PMEM#" + email }
func gsi2Alias(alias string) string  { return "ALIAS#" + alias }

// av wraps a string as a DynamoDB AttributeValue (avoids name collision with receiver).
func av(v string) types.AttributeValue { return &types.AttributeValueMemberS{Value: v} }
func avn(v int) types.AttributeValue   { return &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", v)} }

func nowTS() string { return time.Now().UTC().Format(time.RFC3339) }

// key builds a primary key map for GetItem/DeleteItem.
func key(pk, sk string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{"PK": av(pk), "SK": av(sk)}
}

// ── Item types ────────────────────────────────────────────────────────────────

type UserItem struct {
	PK             string   `dynamodbav:"PK"`
	SK             string   `dynamodbav:"SK"`
	GoogleSub      string   `dynamodbav:"googleSub"`
	Email          string   `dynamodbav:"email"`
	Name           string   `dynamodbav:"name"`
	AvatarURL      string   `dynamodbav:"avatarUrl"`
	WorkspaceOrder []string `dynamodbav:"workspaceOrder"`
	CreatedAt      string   `dynamodbav:"createdAt"`
	EntityType     string   `dynamodbav:"entityType"`
}

type WorkspaceItem struct {
	PK         string `dynamodbav:"PK"`
	SK         string `dynamodbav:"SK"`
	Name       string `dynamodbav:"name"`
	OwnerCount int    `dynamodbav:"ownerCount"`
	CreatedAt  string `dynamodbav:"createdAt"`
	EntityType string `dynamodbav:"entityType"`
}

type MembershipItem struct {
	PK         string `dynamodbav:"PK"`
	SK         string `dynamodbav:"SK"`
	UserID     string `dynamodbav:"userId,omitempty"`
	Email      string `dynamodbav:"email"`
	Role       string `dynamodbav:"role"`
	CreatedAt  string `dynamodbav:"createdAt"`
	EntityType string `dynamodbav:"entityType"`
	GSI1PK     string `dynamodbav:"GSI1PK"`
	GSI1SK     string `dynamodbav:"GSI1SK"`
}

type LinkItem struct {
	PK         string `dynamodbav:"PK"`
	SK         string `dynamodbav:"SK"`
	Alias      string `dynamodbav:"alias"`
	TargetURL  string `dynamodbav:"targetUrl"`
	Title      string `dynamodbav:"title,omitempty"`
	CreatedAt  string `dynamodbav:"createdAt"`
	UpdatedAt  string `dynamodbav:"updatedAt"`
	EntityType string `dynamodbav:"entityType"`
	GSI2PK     string `dynamodbav:"GSI2PK"`
	GSI2SK     string `dynamodbav:"GSI2SK"`
}

type AliasItem struct {
	PK     string `dynamodbav:"PK"`
	SK     string `dynamodbav:"SK"`
	LinkID string `dynamodbav:"linkId"`
}

type LookupItem struct {
	PK     string `dynamodbav:"PK"`
	SK     string `dynamodbav:"SK"`
	UserID string `dynamodbav:"userId"`
}

// ── User operations ───────────────────────────────────────────────────────────

func (st *Store) GetUser(ctx context.Context, userID string) (*UserItem, error) {
	pk := userPK(userID)
	out, err := st.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &st.table,
		Key:       key(pk, pk),
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var item UserItem
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return nil, err
	}
	return &item, nil
}

func (st *Store) getUserByLookup(ctx context.Context, lookupPK string) (*UserItem, error) {
	out, err := st.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &st.table,
		Key:       key(lookupPK, lookupPK),
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var lookup LookupItem
	if err := attributevalue.UnmarshalMap(out.Item, &lookup); err != nil {
		return nil, err
	}
	return st.GetUser(ctx, lookup.UserID)
}

func (st *Store) GetUserByGoogleSub(ctx context.Context, sub string) (*UserItem, error) {
	return st.getUserByLookup(ctx, gsubPK(sub))
}

func (st *Store) GetUserByEmail(ctx context.Context, email string) (*UserItem, error) {
	return st.getUserByLookup(ctx, emailPK(email))
}

// UpsertUserOnLogin handles the full first-login / returning-login flow.
func (st *Store) UpsertUserOnLogin(ctx context.Context, sub, email, name, picture string) (*UserItem, error) {
	existing, err := st.GetUserByGoogleSub(ctx, sub)
	if err != nil {
		return nil, fmt.Errorf("lookup by gsub: %w", err)
	}

	if existing != nil {
		userID := existing.PK[5:] // strip "USER#"
		pk := userPK(userID)
		_, err := st.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName:        &st.table,
			Key:              key(pk, pk),
			UpdateExpression: aws.String("SET email = :e, #n = :nm, avatarUrl = :a"),
			ExpressionAttributeNames: map[string]string{"#n": "name"},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":e":  av(email),
				":nm": av(name),
				":a":  av(picture),
			},
		})
		if err != nil {
			return nil, fmt.Errorf("update user: %w", err)
		}
		user, err := st.GetUser(ctx, userID)
		if err != nil {
			return nil, err
		}
		if err := st.linkPreSignupMemberships(ctx, user); err != nil {
			return nil, err
		}
		// Re-fetch only if linkPreSignupMemberships may have updated workspaceOrder.
		return st.GetUser(ctx, userID)
	}

	// New user — create user + personal workspace atomically.
	userID := uuid.New().String()
	wsID := uuid.New().String()
	memID := uuid.New().String()
	ts := nowTS()

	userMap, _ := attributevalue.MarshalMap(UserItem{
		PK: userPK(userID), SK: userPK(userID),
		GoogleSub: sub, Email: email, Name: name, AvatarURL: picture,
		WorkspaceOrder: []string{wsID}, CreatedAt: ts, EntityType: "USER",
	})
	gsubMap, _ := attributevalue.MarshalMap(LookupItem{
		PK: gsubPK(sub), SK: gsubPK(sub), UserID: userID,
	})
	emailMap, _ := attributevalue.MarshalMap(LookupItem{
		PK: emailPK(email), SK: emailPK(email), UserID: userID,
	})
	wsMap, _ := attributevalue.MarshalMap(WorkspaceItem{
		PK: wsPK(wsID), SK: "META",
		Name: name + "'s workspace", OwnerCount: 1, CreatedAt: ts, EntityType: "WORKSPACE",
	})
	memMap, _ := attributevalue.MarshalMap(MembershipItem{
		PK: wsPK(wsID), SK: memSK(memID),
		UserID: userID, Email: email, Role: "owner", CreatedAt: ts,
		EntityType: "MEMBERSHIP",
		GSI1PK:     gsi1UserMem(userID), GSI1SK: wsPK(wsID),
	})

	_, err = st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: &st.table, Item: userMap, ConditionExpression: aws.String("attribute_not_exists(PK)")}},
			{Put: &types.Put{TableName: &st.table, Item: gsubMap}},
			{Put: &types.Put{TableName: &st.table, Item: emailMap}},
			{Put: &types.Put{TableName: &st.table, Item: wsMap}},
			{Put: &types.Put{TableName: &st.table, Item: memMap}},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create user tx: %w", err)
	}

	user, err := st.GetUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if err := st.linkPreSignupMemberships(ctx, user); err != nil {
		return nil, err
	}
	return st.GetUser(ctx, userID)
}

func (st *Store) linkPreSignupMemberships(ctx context.Context, user *UserItem) error {
	userID := user.PK[5:] // strip "USER#"

	out, err := st.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &st.table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": av(gsi1PreMem(user.Email)),
		},
	})
	if err != nil || len(out.Items) == 0 {
		return err
	}

	var newWSIDs []string
	for _, item := range out.Items {
		var mem MembershipItem
		if err := attributevalue.UnmarshalMap(item, &mem); err != nil {
			continue
		}
		_, err := st.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName:        &st.table,
			Key:              key(mem.PK, mem.SK),
			UpdateExpression: aws.String("SET userId = :uid, GSI1PK = :g1pk"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":uid":  av(userID),
				":g1pk": av(gsi1UserMem(userID)),
			},
		})
		if err != nil {
			return fmt.Errorf("link membership %s: %w", mem.SK, err)
		}
		wsID := mem.PK[3:] // strip "WS#"
		newWSIDs = append(newWSIDs, wsID)
	}

	if len(newWSIDs) > 0 {
		appendList, _ := attributevalue.MarshalList(newWSIDs)
		pk := userPK(userID)
		_, err := st.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName:        &st.table,
			Key:              key(pk, pk),
			UpdateExpression: aws.String("SET workspaceOrder = list_append(if_not_exists(workspaceOrder, :empty), :ids)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":ids":   &types.AttributeValueMemberL{Value: appendList},
				":empty": &types.AttributeValueMemberL{Value: []types.AttributeValue{}},
			},
		})
		if err != nil {
			return fmt.Errorf("append workspace order: %w", err)
		}
	}
	return nil
}

// ── Workspace operations ──────────────────────────────────────────────────────

func (st *Store) GetWorkspace(ctx context.Context, wsID string) (*WorkspaceItem, error) {
	out, err := st.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &st.table,
		Key:       key(wsPK(wsID), "META"),
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var item WorkspaceItem
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return nil, err
	}
	return &item, nil
}

func (st *Store) GetUserMembershipRole(ctx context.Context, userID, wsID string) (string, bool) {
	out, err := st.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &st.table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk AND GSI1SK = :sk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": av(gsi1UserMem(userID)),
			":sk": av(wsPK(wsID)),
		},
	})
	if err != nil || len(out.Items) == 0 {
		return "", false
	}
	var mem MembershipItem
	if err := attributevalue.UnmarshalMap(out.Items[0], &mem); err != nil {
		return "", false
	}
	return mem.Role, true
}

func (st *Store) CreateWorkspace(ctx context.Context, userID, userEmail, name string) (string, error) {
	wsID := uuid.New().String()
	memID := uuid.New().String()
	ts := nowTS()

	wsMarshal, _ := attributevalue.MarshalMap(WorkspaceItem{
		PK: wsPK(wsID), SK: "META",
		Name: name, OwnerCount: 1, CreatedAt: ts, EntityType: "WORKSPACE",
	})
	memMarshal, _ := attributevalue.MarshalMap(MembershipItem{
		PK: wsPK(wsID), SK: memSK(memID),
		UserID: userID, Email: userEmail, Role: "owner", CreatedAt: ts,
		EntityType: "MEMBERSHIP",
		GSI1PK:     gsi1UserMem(userID), GSI1SK: wsPK(wsID),
	})
	pk := userPK(userID)

	_, err := st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: &st.table, Item: wsMarshal}},
			{Put: &types.Put{TableName: &st.table, Item: memMarshal}},
			{Update: &types.Update{
				TableName:        &st.table,
				Key:              key(pk, pk),
				UpdateExpression: aws.String("SET workspaceOrder = list_append(if_not_exists(workspaceOrder, :empty), :ws)"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":ws":    &types.AttributeValueMemberL{Value: []types.AttributeValue{av(wsID)}},
					":empty": &types.AttributeValueMemberL{Value: []types.AttributeValue{}},
				},
			}},
		},
	})
	if err != nil {
		return "", fmt.Errorf("create workspace tx: %w", err)
	}
	return wsID, nil
}

func (st *Store) UpdateWorkspaceName(ctx context.Context, wsID, name string) error {
	_, err := st.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        &st.table,
		Key:              key(wsPK(wsID), "META"),
		UpdateExpression: aws.String("SET #n = :n"),
		ExpressionAttributeNames: map[string]string{
			"#n": "name",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":n": av(name),
		},
	})
	return err
}

func (st *Store) UpdateWorkspaceOrder(ctx context.Context, userID string, order []string) error {
	orderList, _ := attributevalue.MarshalList(order)
	pk := userPK(userID)
	_, err := st.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName:        &st.table,
		Key:              key(pk, pk),
		UpdateExpression: aws.String("SET workspaceOrder = :o"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":o": &types.AttributeValueMemberL{Value: orderList},
		},
	})
	return err
}

func (st *Store) ListWorkspacesForUser(ctx context.Context, userID string) ([]map[string]string, error) {
	user, err := st.GetUser(ctx, userID)
	if err != nil || user == nil {
		return nil, err
	}
	if len(user.WorkspaceOrder) == 0 {
		return []map[string]string{}, nil
	}

	// Get memberships via GSI1 for role info.
	memOut, err := st.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &st.table,
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": av(gsi1UserMem(userID)),
		},
	})
	if err != nil {
		return nil, err
	}
	roleMap := map[string]string{}
	for _, item := range memOut.Items {
		var mem MembershipItem
		if err := attributevalue.UnmarshalMap(item, &mem); err != nil {
			continue
		}
		roleMap[mem.PK[3:]] = mem.Role // strip "WS#"
	}

	// BatchGetItem for workspace metadata.
	keys := make([]map[string]types.AttributeValue, 0, len(user.WorkspaceOrder))
	for _, wsID := range user.WorkspaceOrder {
		keys = append(keys, key(wsPK(wsID), "META"))
	}
	batchOut, err := st.client.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{
		RequestItems: map[string]types.KeysAndAttributes{
			st.table: {Keys: keys},
		},
	})
	if err != nil {
		return nil, err
	}

	wsMap := map[string]WorkspaceItem{}
	for _, item := range batchOut.Responses[st.table] {
		var ws WorkspaceItem
		if err := attributevalue.UnmarshalMap(item, &ws); err != nil {
			continue
		}
		wsMap[ws.PK[3:]] = ws // strip "WS#"
	}

	// Build result in workspace_order order.
	result := make([]map[string]string, 0, len(user.WorkspaceOrder))
	for _, wsID := range user.WorkspaceOrder {
		ws, ok := wsMap[wsID]
		if !ok {
			continue
		}
		role := roleMap[wsID]
		if role == "" {
			continue
		}
		result = append(result, map[string]string{
			"id": wsID, "name": ws.Name, "createdAt": ws.CreatedAt, "role": role,
		})
	}
	return result, nil
}

// ── Resolve ───────────────────────────────────────────────────────────────────

func (st *Store) ResolveAlias(ctx context.Context, userID, alias string) (string, error) {
	user, err := st.GetUser(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return "", fmt.Errorf("user not found")
	}

	out, err := st.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &st.table,
		IndexName:              aws.String("GSI2"),
		KeyConditionExpression: aws.String("GSI2PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": av(gsi2Alias(alias)),
		},
	})
	if err != nil {
		return "", err
	}
	if len(out.Items) == 0 {
		return "", nil
	}

	// Build priority map from workspace_order.
	priority := map[string]int{}
	for i, wsID := range user.WorkspaceOrder {
		priority[wsID] = i
	}

	type candidate struct {
		targetURL string
		prio      int
	}
	var candidates []candidate
	for _, item := range out.Items {
		var link LinkItem
		if err := attributevalue.UnmarshalMap(item, &link); err != nil {
			continue
		}
		wsID := link.PK[3:] // strip "WS#"
		prio, isMember := priority[wsID]
		if !isMember {
			continue
		}
		candidates = append(candidates, candidate{targetURL: link.TargetURL, prio: prio})
	}

	if len(candidates) == 0 {
		return "", nil
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].prio < candidates[j].prio })
	return candidates[0].targetURL, nil
}

// ── Link operations ───────────────────────────────────────────────────────────

func (st *Store) ListLinksByWorkspace(ctx context.Context, wsID, search string, offset, limit int) ([]LinkItem, error) {
	out, err := st.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &st.table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     av(wsPK(wsID)),
			":prefix": av("LINK#"),
		},
	})
	if err != nil {
		return nil, err
	}

	var links []LinkItem
	for _, item := range out.Items {
		var link LinkItem
		if err := attributevalue.UnmarshalMap(item, &link); err != nil {
			continue
		}
		if search != "" {
			lower := strings.ToLower(search)
			if !strings.Contains(strings.ToLower(link.Alias), lower) &&
				!strings.Contains(strings.ToLower(link.Title), lower) {
				continue
			}
		}
		links = append(links, link)
	}

	sort.Slice(links, func(i, j int) bool { return links[i].UpdatedAt > links[j].UpdatedAt })

	if offset >= len(links) {
		return []LinkItem{}, nil
	}
	end := offset + limit
	if end > len(links) {
		end = len(links)
	}
	return links[offset:end], nil
}

func (st *Store) ListAllLinksForUser(ctx context.Context, userID, search string, offset, limit int) ([]LinkItem, error) {
	user, err := st.GetUser(ctx, userID)
	if err != nil || user == nil {
		return nil, err
	}

	var allLinks []LinkItem
	for _, wsID := range user.WorkspaceOrder {
		links, err := st.ListLinksByWorkspace(ctx, wsID, search, 0, 10000)
		if err != nil {
			continue
		}
		allLinks = append(allLinks, links...)
	}

	sort.Slice(allLinks, func(i, j int) bool { return allLinks[i].UpdatedAt > allLinks[j].UpdatedAt })

	if offset >= len(allLinks) {
		return []LinkItem{}, nil
	}
	end := offset + limit
	if end > len(allLinks) {
		end = len(allLinks)
	}
	return allLinks[offset:end], nil
}

func (st *Store) GetLink(ctx context.Context, wsID, linkID string) (*LinkItem, error) {
	out, err := st.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &st.table,
		Key:       key(wsPK(wsID), linkSK(linkID)),
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var item LinkItem
	if err := attributevalue.UnmarshalMap(out.Item, &item); err != nil {
		return nil, err
	}
	return &item, nil
}

func (st *Store) CreateLink(ctx context.Context, wsID, alias, targetURL, title string) (*LinkItem, error) {
	linkID := uuid.New().String()
	ts := nowTS()

	link := LinkItem{
		PK: wsPK(wsID), SK: linkSK(linkID),
		Alias: alias, TargetURL: targetURL, Title: title,
		CreatedAt: ts, UpdatedAt: ts, EntityType: "LINK",
		GSI2PK: gsi2Alias(alias), GSI2SK: wsPK(wsID),
	}
	aliasGuard := AliasItem{
		PK: wsPK(wsID), SK: aliasSK(alias), LinkID: linkID,
	}

	linkMarshal, _ := attributevalue.MarshalMap(link)
	aliasMarshal, _ := attributevalue.MarshalMap(aliasGuard)

	_, err := st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: &st.table, Item: linkMarshal}},
			{Put: &types.Put{
				TableName:           &st.table,
				Item:                aliasMarshal,
				ConditionExpression: aws.String("attribute_not_exists(PK)"),
			}},
		},
	})
	if err != nil {
		if strings.Contains(err.Error(), "ConditionalCheckFailed") || strings.Contains(err.Error(), "TransactionCanceled") {
			return nil, fmt.Errorf("alias_conflict")
		}
		return nil, err
	}
	return &link, nil
}

func (st *Store) UpdateLink(ctx context.Context, wsID, linkID string, alias, targetURL, title *string) (*LinkItem, error) {
	existing, err := st.GetLink(ctx, wsID, linkID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	ts := nowTS()
	newAlias := existing.Alias
	newTarget := existing.TargetURL
	newTitle := existing.Title
	if alias != nil {
		newAlias = *alias
	}
	if targetURL != nil {
		newTarget = *targetURL
	}
	if title != nil {
		newTitle = *title
	}

	updated := LinkItem{
		PK: wsPK(wsID), SK: linkSK(linkID),
		Alias: newAlias, TargetURL: newTarget, Title: newTitle,
		CreatedAt: existing.CreatedAt, UpdatedAt: ts, EntityType: "LINK",
		GSI2PK: gsi2Alias(newAlias), GSI2SK: wsPK(wsID),
	}
	updatedMarshal, _ := attributevalue.MarshalMap(updated)

	aliasChanged := alias != nil && *alias != existing.Alias
	if aliasChanged {
		newAliasMarshal, _ := attributevalue.MarshalMap(AliasItem{
			PK: wsPK(wsID), SK: aliasSK(newAlias), LinkID: linkID,
		})
		_, err = st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
			TransactItems: []types.TransactWriteItem{
				{Put: &types.Put{TableName: &st.table, Item: updatedMarshal}},
				{Delete: &types.Delete{
					TableName: &st.table,
					Key:       key(wsPK(wsID), aliasSK(existing.Alias)),
				}},
				{Put: &types.Put{
					TableName:           &st.table,
					Item:                newAliasMarshal,
					ConditionExpression: aws.String("attribute_not_exists(PK)"),
				}},
			},
		})
		if err != nil {
			if strings.Contains(err.Error(), "ConditionalCheckFailed") || strings.Contains(err.Error(), "TransactionCanceled") {
				return nil, fmt.Errorf("alias_conflict")
			}
			return nil, err
		}
	} else {
		_, err = st.client.PutItem(ctx, &dynamodb.PutItemInput{
			TableName: &st.table,
			Item:      updatedMarshal,
		})
		if err != nil {
			return nil, err
		}
	}
	return &updated, nil
}

func (st *Store) DeleteLink(ctx context.Context, wsID, linkID string) error {
	existing, err := st.GetLink(ctx, wsID, linkID)
	if err != nil {
		return err
	}
	if existing == nil {
		return fmt.Errorf("not_found")
	}

	_, err = st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Delete: &types.Delete{
				TableName: &st.table,
				Key:       key(wsPK(wsID), linkSK(linkID)),
			}},
			{Delete: &types.Delete{
				TableName: &st.table,
				Key:       key(wsPK(wsID), aliasSK(existing.Alias)),
			}},
		},
	})
	return err
}

// ── Member operations ─────────────────────────────────────────────────────────

func (st *Store) ListMembers(ctx context.Context, wsID string) ([]MembershipItem, error) {
	out, err := st.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              &st.table,
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     av(wsPK(wsID)),
			":prefix": av("MEM#"),
		},
	})
	if err != nil {
		return nil, err
	}

	var members []MembershipItem
	for _, item := range out.Items {
		var mem MembershipItem
		if err := attributevalue.UnmarshalMap(item, &mem); err != nil {
			continue
		}
		members = append(members, mem)
	}
	sort.Slice(members, func(i, j int) bool { return members[i].CreatedAt < members[j].CreatedAt })
	return members, nil
}

func (st *Store) GetMember(ctx context.Context, wsID, memberID string) (*MembershipItem, error) {
	out, err := st.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &st.table,
		Key:       key(wsPK(wsID), memSK(memberID)),
	})
	if err != nil {
		return nil, err
	}
	if out.Item == nil {
		return nil, nil
	}
	var mem MembershipItem
	if err := attributevalue.UnmarshalMap(out.Item, &mem); err != nil {
		return nil, err
	}
	return &mem, nil
}

func (st *Store) AddMember(ctx context.Context, wsID, email, role string) (*MembershipItem, error) {
	// Check for existing membership with this email.
	members, err := st.ListMembers(ctx, wsID)
	if err != nil {
		return nil, err
	}
	for i, m := range members {
		if strings.EqualFold(m.Email, email) {
			oldRole := m.Role
			if oldRole == role {
				return &members[i], nil // no change
			}
			// Upsert: update role + adjust ownerCount atomically.
			txItems := []types.TransactWriteItem{
				{Update: &types.Update{
					TableName:        &st.table,
					Key:              key(m.PK, m.SK),
					UpdateExpression: aws.String("SET #r = :role"),
					ExpressionAttributeNames: map[string]string{"#r": "role"},
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":role": av(role),
					},
				}},
			}
			if oldRole == "user" && role == "owner" {
				txItems = append(txItems, types.TransactWriteItem{
					Update: &types.Update{
						TableName:        &st.table,
						Key:              key(wsPK(wsID), "META"),
						UpdateExpression: aws.String("SET ownerCount = ownerCount + :one"),
						ExpressionAttributeValues: map[string]types.AttributeValue{":one": avn(1)},
					},
				})
			} else if oldRole == "owner" && role == "user" {
				txItems = append(txItems, types.TransactWriteItem{
					Update: &types.Update{
						TableName:           &st.table,
						Key:                 key(wsPK(wsID), "META"),
						UpdateExpression:    aws.String("SET ownerCount = ownerCount - :one"),
						ConditionExpression: aws.String("ownerCount > :one"),
						ExpressionAttributeValues: map[string]types.AttributeValue{":one": avn(1)},
					},
				})
			}
			_, err := st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: txItems})
			if err != nil {
				if strings.Contains(err.Error(), "ConditionalCheckFailed") || strings.Contains(err.Error(), "TransactionCanceled") {
					return nil, fmt.Errorf("last_owner")
				}
				return nil, err
			}
			members[i].Role = role
			return &members[i], nil
		}
	}

	// Resolve user by email if they exist.
	var userID string
	var gsi1pk string
	existingUser, _ := st.GetUserByEmail(ctx, email)
	if existingUser != nil {
		userID = existingUser.PK[5:] // strip "USER#"
		gsi1pk = gsi1UserMem(userID)
	} else {
		gsi1pk = gsi1PreMem(email)
	}

	memID := uuid.New().String()
	ts := nowTS()
	mem := MembershipItem{
		PK: wsPK(wsID), SK: memSK(memID),
		UserID: userID, Email: email, Role: role, CreatedAt: ts,
		EntityType: "MEMBERSHIP",
		GSI1PK:     gsi1pk, GSI1SK: wsPK(wsID),
	}
	memMarshal, _ := attributevalue.MarshalMap(mem)

	txItems := []types.TransactWriteItem{
		{Put: &types.Put{TableName: &st.table, Item: memMarshal}},
	}
	if role == "owner" {
		txItems = append(txItems, types.TransactWriteItem{
			Update: &types.Update{
				TableName:        &st.table,
				Key:              key(wsPK(wsID), "META"),
				UpdateExpression: aws.String("SET ownerCount = ownerCount + :one"),
				ExpressionAttributeValues: map[string]types.AttributeValue{":one": avn(1)},
			},
		})
	}
	if userID != "" {
		pk := userPK(userID)
		txItems = append(txItems, types.TransactWriteItem{
			Update: &types.Update{
				TableName:        &st.table,
				Key:              key(pk, pk),
				UpdateExpression: aws.String("SET workspaceOrder = list_append(if_not_exists(workspaceOrder, :empty), :ws)"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":ws":    &types.AttributeValueMemberL{Value: []types.AttributeValue{av(wsID)}},
					":empty": &types.AttributeValueMemberL{Value: []types.AttributeValue{}},
				},
			},
		})
	}

	_, err = st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: txItems})
	if err != nil {
		return nil, err
	}
	return &mem, nil
}

func (st *Store) UpdateMemberRole(ctx context.Context, wsID, memberID, newRole string) (*MembershipItem, error) {
	mem, err := st.GetMember(ctx, wsID, memberID)
	if err != nil {
		return nil, err
	}
	if mem == nil {
		return nil, fmt.Errorf("not_found")
	}
	if mem.Role == newRole {
		return mem, nil
	}

	txItems := []types.TransactWriteItem{
		{Update: &types.Update{
			TableName:        &st.table,
			Key:              key(mem.PK, mem.SK),
			UpdateExpression: aws.String("SET #r = :role"),
			ExpressionAttributeNames: map[string]string{"#r": "role"},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":role": av(newRole),
			},
		}},
	}

	if mem.Role == "owner" && newRole == "user" {
		// Demoting an owner: decrement ownerCount with guard > 1.
		txItems = append(txItems, types.TransactWriteItem{
			Update: &types.Update{
				TableName:           &st.table,
				Key:                 key(wsPK(wsID), "META"),
				UpdateExpression:    aws.String("SET ownerCount = ownerCount - :one"),
				ConditionExpression: aws.String("ownerCount > :one"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":one": avn(1),
				},
			},
		})
	} else if mem.Role == "user" && newRole == "owner" {
		txItems = append(txItems, types.TransactWriteItem{
			Update: &types.Update{
				TableName:        &st.table,
				Key:              key(wsPK(wsID), "META"),
				UpdateExpression: aws.String("SET ownerCount = ownerCount + :one"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":one": avn(1),
				},
			},
		})
	}

	_, err = st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: txItems})
	if err != nil {
		if strings.Contains(err.Error(), "ConditionalCheckFailed") || strings.Contains(err.Error(), "TransactionCanceled") {
			return nil, fmt.Errorf("last_owner")
		}
		return nil, err
	}
	mem.Role = newRole
	return mem, nil
}

func (st *Store) DeleteMember(ctx context.Context, wsID, memberID string) (string, error) {
	mem, err := st.GetMember(ctx, wsID, memberID)
	if err != nil {
		return "", err
	}
	if mem == nil {
		return "", fmt.Errorf("not_found")
	}

	txItems := []types.TransactWriteItem{
		{Delete: &types.Delete{
			TableName: &st.table,
			Key:       key(mem.PK, mem.SK),
		}},
	}
	if mem.Role == "owner" {
		txItems = append(txItems, types.TransactWriteItem{
			Update: &types.Update{
				TableName:           &st.table,
				Key:                 key(wsPK(wsID), "META"),
				UpdateExpression:    aws.String("SET ownerCount = ownerCount - :one"),
				ConditionExpression: aws.String("ownerCount > :one"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":one": avn(1),
				},
			},
		})
	}

	_, err = st.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: txItems})
	if err != nil {
		if strings.Contains(err.Error(), "ConditionalCheckFailed") || strings.Contains(err.Error(), "TransactionCanceled") {
			return "", fmt.Errorf("last_owner")
		}
		return "", err
	}

	if mem.UserID != "" {
		st.removeWorkspaceFromOrder(ctx, mem.UserID, wsID)
	}
	return mem.UserID, nil
}

func (st *Store) removeWorkspaceFromOrder(ctx context.Context, userID, wsID string) {
	user, err := st.GetUser(ctx, userID)
	if err != nil || user == nil {
		return
	}
	newOrder := make([]string, 0, len(user.WorkspaceOrder))
	for _, id := range user.WorkspaceOrder {
		if id != wsID {
			newOrder = append(newOrder, id)
		}
	}
	st.UpdateWorkspaceOrder(ctx, userID, newOrder) //nolint:errcheck
}

// ── Auth code exchange ───────────────────────────────────────────────────────

// StoreAuthCode saves a short-lived, single-use auth code that maps to a JWT.
// PK = AUTHCODE#<code>, SK = AUTHCODE#<code>, jwt attribute, expiresAt attribute.
func (st *Store) StoreAuthCode(ctx context.Context, code, jwtToken string) error {
	expiresAt := time.Now().Add(60 * time.Second).Unix()
	_, err := st.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &st.table,
		Item: map[string]types.AttributeValue{
			"PK":        av("AUTHCODE#" + code),
			"SK":        av("AUTHCODE#" + code),
			"jwt":       av(jwtToken),
			"expiresAt": avn(int(expiresAt)),
		},
	})
	return err
}

// RedeemAuthCode atomically retrieves and deletes a one-time auth code.
// Returns the JWT if the code is valid and not expired, or an error otherwise.
func (st *Store) RedeemAuthCode(ctx context.Context, code string) (string, error) {
	pk := "AUTHCODE#" + code
	result, err := st.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName:    &st.table,
		Key:          key(pk, pk),
		ReturnValues: types.ReturnValueAllOld,
		ConditionExpression: aws.String("attribute_exists(PK)"),
	})
	if err != nil {
		return "", fmt.Errorf("auth code not found or already used")
	}

	var item struct {
		JWT       string `dynamodbav:"jwt"`
		ExpiresAt int64  `dynamodbav:"expiresAt"`
	}
	if err := attributevalue.UnmarshalMap(result.Attributes, &item); err != nil {
		return "", fmt.Errorf("failed to read auth code")
	}

	if time.Now().Unix() > item.ExpiresAt {
		return "", fmt.Errorf("auth code expired")
	}

	return item.JWT, nil
}
