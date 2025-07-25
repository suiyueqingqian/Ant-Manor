
let { config } = require('../config.js')(runtime, this)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, this)
let { changeAccount, ensureMainAccount } = require('../lib/AlipayAccountManage.js')
let logUtils = singletonRequire('LogUtils')
let floatyInstance = singletonRequire('FloatyUtil')
let LogFloaty = singletonRequire('LogFloaty')
let commonFunctions = singletonRequire('CommonFunction')
let widgetUtils = singletonRequire('WidgetUtils')
let runningQueueDispatcher = singletonRequire('RunningQueueDispatcher')
let fileUtils = singletonRequire('FileUtils')
let automator = singletonRequire('Automator')
let unlocker = require('../lib/Unlock.js')
let WarningFloaty = singletonRequire('WarningFloaty')
let storageFactory = singletonRequire('StorageFactory')
let { logInfo, errorInfo, warnInfo, debugInfo, infoLog } = singletonRequire('LogUtils')

let localOcr = require('../lib/LocalOcrUtil.js')
let DAILY_HELPED = "DAILY_HELPED"
storageFactory.initFactoryByKey(DAILY_HELPED, { executed: {} })
let VillageRunner = require('../core/VillageRunner.js')
runningQueueDispatcher.addRunningTask()
// 注册自动移除运行中任务
commonFunctions.registerOnEngineRemoved(function () {
  // 重置自动亮度
  config.resetBrightness && config.resetBrightness()
  if (config.auto_lock && unlocker.needRelock() === true) {
    logUtils.debugInfo('重新锁定屏幕')
    automator.lockScreen()
  }
  // 移除运行中任务
  runningQueueDispatcher.removeRunningTask(true, false,
    () => {
      // 保存是否需要重新锁屏
      unlocker.saveNeedRelock()
      config.isRunning = false
    }
  )
}, 'main')
if (!commonFunctions.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}
unlocker.exec()
commonFunctions.requestScreenCaptureOrRestart()

if (!config.main_account || config.accounts.length <= 0) {
  toastLog('未配置多账号，或账号信息为空，无法进行助力')
  exit()
}

if (!floatyInstance.init()) {
  toast('创建悬浮窗失败')
  exit()
}
floatyInstance.enableLog()
commonFunctions.showCommonDialogAndWait('切换小号给大号助力')
commonFunctions.listenDelayStart()
commonFunctions.backHomeIfInVideoPackage()

let villageConfig = config.village_config
let helpOthersUrl = null
// 帮助别人助力
// helpOthersUrl = 'alipays://platformapi/startapp?appId=68687809&backgroundColor=16505470&ttb=always&url=%2Fwww%2Fgame.html%3FshareId%3DMjA4ODMwMjEwNzU4MzU0MDFoc3hmeUFOVFNUQUxMX1AyUF9TSEFSRVI=%26shareCoinDisplayAmount=100&source=hyyaoqing&chInfo=hyyaoqing&fxzjshareChinfo=ch_share__chsub_CopyLink&apshareid=c0c75eb5-268e-4341-b13a-d253e51aefa5&shareBizType=ztokenV0_GRuRWlSG'
if (helpOthersUrl) {
  openShareSupport(helpOthersUrl)
  //助力完必须最小化一下 否则容易出错
  commonFunctions.minimize()
}
let currentRunningAccount = ''
let currentHelpAccount = ''
threads.start(function () {
  logUtils.debugInfo(['准备监听toast'])
  events.observeToast()
  logUtils.debugInfo(['监听toast开始'])
  // 监控 toast
  events.onToast(function (toast) {
    let text = toast.getText()
    logUtils.debugInfo(['获取到toast文本：{}', text])
    if (
      toast &&
      toast.getPackageName() &&
      toast.getPackageName().indexOf(config.package_name) >= 0
    ) {
      if (/.*已经帮助过.*/.test(text)) {
        logUtils.debugInfo(['监听到toast，当前帮助过: {}', text])
        setExecuted()
      }
    }
  })
})

function setExecuted () {
  let currentStorage = storageFactory.getValueByKey(DAILY_HELPED)
  currentStorage.executed[currentRunningAccount + currentHelpAccount] = true
  storageFactory.updateValueByKey(DAILY_HELPED, currentStorage)
}

if (config.accounts && config.accounts.length > 1) {
  // 先执行循环助力
  config.accounts.forEach((accountInfo) => {
    let { account, accountName } = accountInfo
    currentRunningAccount = account

    // 检查是否已经全都助力过，是的话跳过本次切换处理
    if (config.accounts.filter(other => {
      if (other.account == account) {
        return false
      }
      currentHelpAccount = other.account
      if (storageFactory.getValueByKey(DAILY_HELPED).executed[currentRunningAccount + currentHelpAccount]) {
        LogFloaty.pushLog('此账号已经被助力过，不再执行: ' + currentHelpAccount)
        return false
      }
      return true
    }).length == 0) {
      LogFloaty.pushLog('所有账号都已经被助力过，不再执行当前账号的助力操作: ' + account)
      return
    }

    LogFloaty.pushLog('准备切换账号为：' + account)
    sleep(1000)
    changeAccount(account)
    LogFloaty.pushLog('切换完毕')
    sleep(500)
    LogFloaty.pushLog('开始执行助力')
    try {
      let total = config.accounts.length
      config.accounts.filter(v => v.account != account).forEach((other, idx) => {
        currentHelpAccount = other.account
        if (storageFactory.getValueByKey(DAILY_HELPED).executed[currentRunningAccount + currentHelpAccount]) {
          LogFloaty.pushLog('此账号已经被助力过，不再执行: ' + currentHelpAccount)
          return
        }
        // 打开助力
        openShareSupport(other.shareUrl)
        floatyInstance.setFloatyInfo({ x: config.device_width / 2, y: config.device_height / 2 }, other.account + ' 助力完成 ')
        if (idx + 1 < total - 1) {
          commonFunctions.minimize()
          LogFloaty.pushLog(other.account + ' 助力完成，等待几秒钟')
          sleep(5000)
        }
      })

      LogFloaty.pushLog('切换下一个账号')
      sleep(500)
    } catch (e) {
      logUtils.errorInfo('执行异常：' + e)
      LogFloaty.pushLog('助力异常 进行下一个')
    }
  })
  let hasFailed = false
  // 领取加速收益和签到
  config.accounts.forEach((accountInfo, idx) => {
    let { account, accountName } = accountInfo
    // if (account === config.main_account) {
    //   return
    // }
    LogFloaty.pushLog('准备切换账号为：' + account)
    sleep(1000)
    changeAccount(account)
    if (!widgetUtils.widgetCheck('首页', 2000)) {
      LogFloaty.pushLog('切换完毕，返回桌面 以便正常打开首页')
      commonFunctions.minimize()
    } else {
      LogFloaty.pushLog('切换完毕')
    }
    sleep(500)
    LogFloaty.pushLog('开始执行加速产豆')
    try {
      // 打开首页
      if (!VillageRunner.tryOpenVillageByHomeWidget()) {
        openMyVillage()
      }
      sleep(1000)
      // 自动点击自己的能量豆
      automator.click(villageConfig.village_reward_click_x, villageConfig.village_reward_click_y)
      // 签到
      if (!VillageRunner.speedAward(true)) {
        LogFloaty.pushLog('当前账号未能成功执行签到，需要延迟重试:' + account)
        hasFailed = true
      }
      LogFloaty.pushLog('切换下一个账号')
      sleep(500)
    } catch (e) {
      logUtils.errorInfo('执行异常：' + e)
      commonFunctions.printExceptionStack(e)
      LogFloaty.pushLog('领取异常 进行下一个')
    }
  })
  if (hasFailed) {
    LogFloaty.pushWarningLog('有账号执行失败，延迟5分钟重试')
    commonFunctions.setUpAutoStart(5)
  }
  LogFloaty.pushLog('全部账号能量助力完毕切换回主账号')
  sleep(1000)
  ensureMainAccount()
  sleep(500)
} else {
  logUtils.errorInfo(['当前未配置多账号或账号只有一个，不进行切换'], true)
}
commonFunctions.minimize()
exit()

function openShareSupport (shareUrl) {
  app.startActivity({
    action: 'VIEW',
    data: inspectShareUrl(shareUrl),
    packageName: 'com.eg.android.AlipayGphone'
  })
  // startActivity方法会不给奖励，尝试改用http方式打开分享链接
  // app.openUrl(wrapBrowserUrl(shareUrl))
  floatyInstance.setFloatyInfo({ x: config.device_width / 2, y: config.device_height / 2 }, "查找是否有'打开'对话框")
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }
  sleep(1000)
  let confirmCollect = widgetUtils.widgetGetOne('收下了|我知道了')
  if (confirmCollect) {
    let point = confirmCollect.bounds()
    floatyInstance.setFloatyInfo({ x: point.centerX(), y: point.centerY() }, confirmCollect.text() || confirmCollect.desc())
    confirmCollect.click()
    setExecuted()
  } else {
    warnInfo(['没有收下/我知道了按钮，可能已经助力过或者被拉黑了'])
  }
}

function openMyVillage (retry) {
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=68687809',
    packageName: 'com.eg.android.AlipayGphone'
  })

  sleep(1500)
  if (!VillageRunner.waitForLoading() && !retry) {
    LogFloaty.pushLog('打开蚂蚁新村失败，重新打开')
    VillageRunner.killAlipay()
    sleep(3000)
    openMyVillage()
  }
}

/**
 * 截取scheme内容
 * 
 * @param {string} shareUrl 
 * @returns 
 */
function inspectShareUrl (shareUrl) {
  if (shareUrl.startsWith('http')) {
    let decodeUrl = decodeURIComponent(shareUrl)
    console.log('decoded:', decodeUrl)
    return decodeUrl.split('scheme=')[1]
  }
  return shareUrl
}

/**
 * 给scheme链接包裹上https，触发支付宝的AppLinksActivity而不是SchemeLauncherActivity
 *
 * @param {string} shareUrl 
 * @returns 
 */
function wrapBrowserUrl (shareUrl) {
  if (shareUrl.startsWith('http')) {
    return shareUrl
  }
  return 'https://render.alipay.com/p/s/i/?scheme=' + encodeURIComponent(shareUrl)
}