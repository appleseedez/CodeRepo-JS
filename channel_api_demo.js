function initialize() {
    console.log("Initializing; room=99688636.");
    card = document.getElementById("card");
    localVideo = document.getElementById("localVideo");
    miniVideo = document.getElementById("miniVideo");
    remoteVideo = document.getElementById("remoteVideo");
    resetStatus();
    openChannel('AHRlWrqvgCpvbd9B-Gl5vZ2F1BlpwFv0xBUwRgLF/* ...*/');/*room token 由Google App Engine app 提供*/
    doGetUserMedia();//确认浏览器是否支持getUserMedia API 如果支持则调用onUserMediaSuccess
}
/* 建立通道过程
.客户端A生成一个唯一的ID
.客户端A把ID传给App Engine app，请求获得Channel token
.App Engine app 把ID传给 Channel API,请求获得一个channel和token
.App把token传给客户端A
.客户端A打开socket,监听channel
*/
function openChannel(channelToken) {
  console.log("Opening channel.");
  var channel = new goog.appengine.Channel(channelToken);
  var handler = {
    'onopen': onChannelOpened,
    'onmessage': onChannelMessage,
    'onerror': onChannelError,
    'onclose': onChannelClosed
  };
  socket = channel.open(handler);
}
/*Sending a message works like this:
.Client B makes a POST request to the App Engine app with an update.
.The App Engine app passes a request to the channel.
.The channel carries a message to Client A.
.Client A's onmessage callback is called.
*/
//如果浏览器支持getUserMedia,则函数被调用
function onUserMediaSuccess(stream) {
  console.log("User has granted access to local media.");
  // Call the polyfill wrapper to attach the media stream to this element.
  attachMediaStream(localVideo, stream);//localVideo.src = ... localViedo代表一个标签
  localVideo.style.opacity = 1;
  localStream = stream;
  // Caller creates PeerConnection.
  if (initiator) maybeStart();//initiator 已经被设置为1，直到caller的session终止 所以这里会调用maybeStart
}
//connection只会被建立一次 
//建立前提1.第一次建立 2.localStream已经准备好了，即本地视频 3.信令通道准备好了
function maybeStart() {
  if (!started && localStream && channelReady) {
    // ...调用func,使用STUN创建RTCPeerConnection(pc),设置各种事件监听函数
    createPeerConnection();
    // ...
    pc.addStream(localStream);
    started = true;
    // Caller initiates offer to peer.
    if (initiator)
      doCall();
  }
}
//被maybeStart调用
//主要目的是使用STUN服务器和回调函数onIceCandidata来建立connection
//为每一个RTCPeerConnection事件建立handlers
function createPeerConnection() {
  var pc_config = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};
  try {
    // Create an RTCPeerConnection via the polyfill (adapter.js).
    pc = new RTCPeerConnection(pc_config);//在adapter.js中被包装过了
    pc.onicecandidate = onIceCandidate;
    console.log("Created RTCPeerConnnection with config:\n" + "  \"" +
      JSON.stringify(pc_config) + "\".");
  } catch (e) {
    console.log("Failed to create PeerConnection, exception: " + e.message);
    alert("Cannot create RTCPeerConnection object; WebRTC is not supported by this browser.");
      return;
  }

  pc.onconnecting = onSessionConnecting;//log status messages作用
  pc.onopen = onSessionOpened;            //log status messages作用
  pc.onaddstream = onRemoteStreamAdded;    //log status messages作用
  pc.onremovestream = onRemoteStreamRemoved;//为remoteVideo标签设置内容 
}
//handler
function onRemoteStreamAdded(event) {
  // ...
  miniVideo.src = localVideo.src;
  attachMediaStream(remoteVideo, event.stream);
  remoteStream = event.stream;
  waitForRemoteVideo();
}
//在maybeStart()调用createPeerConnection()之后, a call is intitiated by creating and offer and sending it to the callee
function doCall() {
  console.log("Sending offer to peer.");
  pc.createOffer(setLocalAndSendMessage, null, mediaConstraints);
}
//创建offer的过程和非信令的例子（caller callee都在一个浏览器内）类似。
//不同点:message被发送到远端（remote peer），giving a serialized SessionDescription
//不同点的功能有setLocalAndMessage()完成
//客户端配置信息叫做Session Description
function setLocalAndSendMessage(sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pc.setLocalDescription(sessionDescription);
  sendMessage(sessionDescription);
}
/*signaling with the Channel API*/
/*当createPeerConnection()成功创建RTCPeerConnetion后 回调函数onIceCandidate被调用:
发送收集来的candidates的信息
*/
 function onIceCandidate(event) {
    if (event.candidate) {
    //使用XHR请求，客户端向服务器发送出站信息
      sendMessage({type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate});
    } else {
      console.log("End of candidates.");
    }
  }
//使用XHR请求，从客户端向服务器发送出站消息（Outbound messaging）
function sendMessage(message) {
  var msgString = JSON.stringify(message);
  console.log('C->S: ' + msgString);
  path = '/message?r=99688636' + '&u=92246248';
  var xhr = new XMLHttpRequest();
  xhr.open('POST', path, true);
  xhr.send(msgString);
}
/*
客户端->服务器发送信令消息：使用XHR
服务器->客户端发送信令消息：使用Google App Engine Channel API
*/
//处理由App Engine server发送来的消息
function processSignalingMessage(message) {
  var msg = JSON.parse(message);

  if (msg.type === 'offer') {
    // Callee creates PeerConnection
    if (!initiator && !started)//initiator代表session是否创建 RTCPeerConnection是否被创建
      maybeStart();

    pc.setRemoteDescription(new RTCSessionDescription(msg));
    doAnswer();
  } else if (msg.type === 'answer' && started) {
    pc.setRemoteDescription(new RTCSessionDescription(msg));
  } else if (msg.type === 'candidate' && started) {
    var candidate = new RTCIceCandidate({sdpMLineIndex:msg.label,
                                         candidate:msg.candidate});
    pc.addIceCandidate(candidate);//??
  } else if (msg.type === 'bye' && started) {
    onRemoteHangup();
  }
}
function doAnswer() {
  console.log("Sending answer to peer.");
  pc.createAnswer(setLocalAndSendMessage, null, mediaConstraints);
}
//在哪里设置msg.type？

View Code