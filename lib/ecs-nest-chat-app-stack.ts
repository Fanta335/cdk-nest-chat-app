import { aws_ec2 as ec2, aws_ecs as ecs, aws_elasticloadbalancingv2 as elbv2, aws_autoscaling as autoscaling, Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";

export class CdkNestChatAppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, "VPC", {
      cidr: "10.0.0.0/16",
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "ingres",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "application",
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        },
        {
          cidrMask: 24,
          name: "rds",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // Security groups
    // SG for ELB
    const securityGroupELB = new ec2.SecurityGroup(this, "SecurityGroupELB", {
      vpc,
      description: "Security group ELB",
      securityGroupName: "SGELB",
    });
    securityGroupELB.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Allow all HTTP traffic");

    // SG for application on ECS
    const securityGroupApp = new ec2.SecurityGroup(this, "SecurityGroupApp", {
      vpc,
      description: "Security group App",
      securityGroupName: "SGAPP",
    });
    securityGroupApp.addIngressRule(securityGroupELB, ec2.Port.tcp(80), "Allow HTTP traffic from ELB");

    // ALB
    const alb = new elbv2.ApplicationLoadBalancer(this, "ALB", {
      vpc,
      securityGroup: securityGroupELB,
      internetFacing: true,
      loadBalancerName: "ALB",
    });

    const listener = alb.addListener("Listener", {
      port: 80,
      open: true,
    });

    // Target group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, "TargetGroup", {
      vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: "/",
        interval: Duration.seconds(60),
        healthyHttpCodes: "200",
      },
    });

    listener.addTargetGroups("TargetGroup", {
      targetGroups: [targetGroup],
    });

    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, "ASG", {
      vpc,
      instanceType: new ec2.InstanceType("t2.micro"),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      userData: ec2.UserData.forLinux(),
      maxCapacity: 2,
      minCapacity: 1,
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const capacityProvider = new ecs.AsgCapacityProvider(this, "AsgCapacityProvider", {
      autoScalingGroup,
      machineImageType: ecs.MachineImageType.AMAZON_LINUX_2,
      spotInstanceDraining: true,
    });

    cluster.addAsgCapacityProvider(capacityProvider);

    // ECS Task definition
    const taskDefinition = new ecs.Ec2TaskDefinition(this, "TaskDefinition", {
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    const container = taskDefinition.addContainer("Container", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 256,
      cpu: 256,
    });

    container.addPortMappings({
      hostPort: 80,
      containerPort: 80,
      protocol: ecs.Protocol.TCP,
    });

    // ECS service
    const service = new ecs.Ec2Service(this, "Service", {
      cluster,
      taskDefinition,
      securityGroups: [securityGroupApp],
    });
    service.attachToApplicationTargetGroup(targetGroup);
  }
}
