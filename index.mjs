/*
***************************************************************************
   機能　　　　　:アクティベーション登録
   戻り値　　　　: 以下の情報を返却する
                  status:
                  200 (OK)	アクティベーション情報を上書き登録した
                  201 (Created)	アクティベーション情報を新規に登録した
                  409 (Conflict)	他のデバイスが登録済み
                  
                  body:
                  serialNo	製品シリアルナンバー
                  lastUpdateTime	最終更新時刻(UTC)
                  machineId		登録済みデバイスID
                  
   Create       ：2024/07/11　LongPham 
***************************************************************************
*/

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DateTime } from 'luxon';

// DynamoDB クライアントと DynamoDBDocumentClient を初期化
const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

// テーブル名の設定
const tableName = "ActivationData";
const logTableName = "ActivationLog";

// 現在の時刻(UTC)を取得する関数
const getCurrentTime = () => {
  const now = DateTime.now().toUTC(); // 現在の時刻(UTC)
  return now.toFormat('yyyy/MM/dd HH:mm:ss'); // フォーマットされた時刻を返す
};

// 現在のタイムスタンプ(UTC)を取得する関数
const getCurrentTimestamp = () => {
  const now = DateTime.now().toUTC(); // 現在の時刻(UTC)
  return now.toMillis(); // ミリ秒単位の時間を返す
};

// ログテーブルに操作を記録する関数
const logOperation = async (requestJSON, operation, description,clientIp) => {
  const timestamp = getCurrentTimestamp();
  const logItem = {
    serial_no: requestJSON.serialNo, // シリアル番号
    timestamp: timestamp, // タイムスタンプ
    machine_id: requestJSON.machineId, // 機械ID
    operation: operation, // 操作内容
    description: description, // 説明
    client_time: requestJSON.clientTime, // クライアントの時間
    client_ipaddress: clientIp, // クライアントのIPアドレス
    client_os: `${requestJSON.osName} ${requestJSON.osVersion}`, // クライアントのOS
    client_machine: requestJSON.machineName, // クライアントの機械名
    client_user: requestJSON.userName, // クライアントのユーザー名
  };

  // DynamoDB にログを記録
  await dynamo.send(
    new PutCommand({
      TableName: logTableName,
      Item: logItem,
    })
  );
};

// Lambda 関数のハンドラ
export const handler = async (event) => {
  let statusCode = 200; // デフォルトのステータスコードは200 (OK)
  let body;
  const requestJSON = JSON.parse(event.body); // リクエストボディをJSONに変換
  const currentTime = getCurrentTime(); // 現在の時間を取得
  // クライアントIPアドレスを event.requestContext.identity.sourceIp から取得
  const clientIp = event.requestContext.http.sourceIp;

  try {
    // GET /activations/{serial_no} の結果を確認
    const queryResult = await dynamo.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "serial_no = :serial_no", // シリアル番号に基づくクエリ
        ExpressionAttributeValues: {
          ":serial_no": requestJSON.serialNo,
        },
      })
    );

    const items = queryResult.Items;

    if (queryResult.Count === 0) { // 件数 = 0 の場合、１番目デバイスとして登録
      await dynamo.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            serial_no: requestJSON.serialNo, // シリアル番号
            machine_id: requestJSON.machineId, // 機械ID
            client_ipaddress: clientIp, // クライアントのIPアドレス
            client_os: requestJSON.osName, // クライアントのOS
            client_time: requestJSON.clientTime, // クライアントの時間
            update_time: currentTime, // 更新時間
          },
        })
      );
      statusCode = 201; // 新規作成のステータス
      await logOperation(requestJSON, "Add", '',clientIp); // ログを記録
      body = {
        serialNo: requestJSON.serialNo,
        lastUpdateTime: currentTime,
        machineId: requestJSON.machineId,
        // message: `シリアル番号（${requestJSON.serialNo}） と machine_id（${requestJSON.machineId}）で１つ目のデバイスアイテムを登録しました`,
      };
    } else {
      const existingItem = items.find(item => item.machine_id === requestJSON.machineId);

      if (existingItem) {
        // デバイスが存在する場合、更新
        await dynamo.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              serial_no: requestJSON.serialNo, // シリアル番号
              machine_id: requestJSON.machineId, // 機械ID
              client_ipaddress: clientIp, // クライアントのIPアドレス
              client_os: requestJSON.osName, // クライアントのOS
              client_time: requestJSON.clientTime, // クライアントの時間
              update_time: currentTime, // 更新時間
            },
          })
        );
        await logOperation(requestJSON, "Upd", '',clientIp); // ログを記録
        body = {
          serialNo: requestJSON.serialNo,
          lastUpdateTime: currentTime,
          machineId: requestJSON.machineId,
          // message: `シリアル番号（${requestJSON.serialNo}） と machine_id（${requestJSON.machineId}） でアイテムを更新しました`,
        };
      } else if (queryResult.Count === 1) {
        // １番目のデバイスが登録済の場合、２番目デバイスを登録
        await dynamo.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              serial_no: requestJSON.serialNo, // シリアル番号
              machine_id: requestJSON.machineId, // 機械ID
              client_ipaddress: clientIp, // クライアントのIPアドレス
              client_os: requestJSON.osName, // クライアントのOS
              client_time: requestJSON.clientTime, // クライアントの時間
              update_time: currentTime, // 更新時間
            },
          })
        );
        statusCode = 201; // 新規作成のステータス
        await logOperation(requestJSON, "Add", '',clientIp); // ログを記録
        body = {
          serialNo: requestJSON.serialNo,
          lastUpdateTime: currentTime,
          machineId: requestJSON.machineId,
          // message: `シリアル番号（${requestJSON.serialNo}） と machine_id（${requestJSON.machineId}） で２つ目のデバイスを登録しました`,
        };
      } else {
        // ２つデバイスが登録済の場合、他者による登録済みとして、登録済みエラー(409)を返す
        statusCode = 409; // 競合のステータス
        await logOperation(requestJSON, "Add", "登録エラー：このシリアル番号で既に複数のデバイスが登録されています",clientIp); // エラーログを記録
        body = {
          serialNo: requestJSON.serialNo,
          lastUpdateTime: currentTime,
          machineId: requestJSON.machineId,
          // message: "登録エラー：このシリアル番号で既に複数のデバイスが登録されています",
        };
      }
    }
  } catch (err) {
    statusCode = 400; // リクエストエラーのステータス
    await logOperation(requestJSON, "Add", err.message,clientIp); // エラーログを記録
    body = {
      serialNo: requestJSON.serialNo,
      lastUpdateTime: currentTime,
      machineId: requestJSON.machineId,
      description: err.message, // エラー説明
    };
  }

  return {
    statusCode,
    body: JSON.stringify(body), // コンテンツを JSON 形式で返す
    headers: {
      "Content-Type": "application/json", // レスポンスのコンテンツタイプを設定
    },
  };
};
